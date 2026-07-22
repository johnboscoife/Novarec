import { join } from 'node:path';
import { BrowserWindow, ipcMain } from 'electron';
import type { IpcMainEvent } from 'electron';
import { RectSchema, type SavedRegion } from '@novarec/shared';
import { displayForRect, virtualDesktopBounds } from '@novarec/capture';
import { getDisplays } from './enumerate.js';

let overlayWindow: BrowserWindow | null = null;

/**
 * Opens the transparent, always-on-top region-selection overlay spanning the
 * whole virtual desktop and resolves with the chosen region (DIP, virtual
 * coordinates) or null if cancelled. The overlay reports only a rect; the
 * owning display and timestamp are computed and validated here in main.
 */
export function beginRegionSelect(): Promise<SavedRegion | null> {
  if (overlayWindow) {
    overlayWindow.focus();
    return Promise.resolve(null);
  }

  const displays = getDisplays();
  const vb = virtualDesktopBounds(displays);

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      x: vb.x,
      y: vb.y,
      width: vb.width,
      height: vb.height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: join(__dirname, '../preload/overlay.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    overlayWindow = win;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    let settled = false;
    const finish = (region: SavedRegion | null): void => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('overlay:confirm', onConfirm);
      ipcMain.removeListener('overlay:cancel', onCancel);
      if (!win.isDestroyed()) win.close();
      overlayWindow = null;
      resolve(region);
    };

    const onConfirm = (_event: IpcMainEvent, rawRect: unknown): void => {
      // Rule: validate every IPC payload on the main side.
      const parsed = RectSchema.safeParse(rawRect);
      if (!parsed.success) {
        finish(null);
        return;
      }
      const rect = parsed.data;
      const owner = displayForRect(displays, rect);
      finish({
        rect,
        displayId: owner?.id ?? null,
        updatedAt: new Date().toISOString(),
      });
    };
    const onCancel = (): void => finish(null);

    ipcMain.on('overlay:confirm', onConfirm);
    ipcMain.on('overlay:cancel', onCancel);
    win.on('closed', () => finish(null));

    const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
    const load = rendererUrl
      ? win.loadURL(`${rendererUrl}/overlay.html`)
      : win.loadFile(join(__dirname, '../renderer/overlay.html'));
    void load;

    win.webContents.once('did-finish-load', () => {
      win.webContents.send('overlay:init', { displays, virtualBounds: vb });
    });
  });
}
