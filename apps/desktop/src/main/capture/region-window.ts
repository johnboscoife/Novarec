import { join } from 'node:path';
import { BrowserWindow, ipcMain } from 'electron';
import type { IpcMainEvent } from 'electron';
import { z } from 'zod';
import { overlayRectToVirtual } from '@novarec/capture';
import { RectSchema, type DisplayInfo, type SavedRegion } from '@novarec/shared';
import { getDisplays } from './enumerate.js';

/** What an overlay reports: a rect local to the display that overlay covers. */
const ConfirmPayload = z.object({
  displayId: z.number(),
  rect: RectSchema,
});

let overlayWindows: BrowserWindow[] = [];

/**
 * Opens the transparent, always-on-top region-selection overlay and resolves
 * with the chosen region (DIP, virtual-desktop coordinates) or null if cancelled.
 *
 * **One overlay window per display**, not one window spanning the virtual
 * desktop. A single spanning window is wrong twice over on Windows:
 *
 *  - `enableLargerThanScreen` is macOS-only, so Windows clamps the window to one
 *    display and the other monitors simply cannot be selected on; and
 *  - a window straddling displays gets ONE device scale factor for its whole web
 *    contents, so its CSS pixels stop matching virtual-desktop DIP and the
 *    selection lands offset from the cursor on mixed-DPI setups.
 *
 * Per-display windows sidestep both: each sits entirely on one monitor, where
 * 1 CSS pixel is exactly 1 DIP of that display, so a local rect converts to
 * virtual coordinates by adding the display's origin — no scaling, no drift.
 * A selection therefore lives on a single display, which is also the only thing
 * the capture crop can honour.
 */
export function beginRegionSelect(): Promise<SavedRegion | null> {
  if (overlayWindows.length > 0) {
    overlayWindows[0]?.focus();
    return Promise.resolve(null);
  }

  const displays = getDisplays();
  if (displays.length === 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (region: SavedRegion | null): void => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('overlay:confirm', onConfirm);
      ipcMain.removeListener('overlay:cancel', onCancel);
      ipcMain.removeListener('overlay:begin', onBegin);
      const windows = overlayWindows;
      overlayWindows = [];
      for (const win of windows) {
        if (!win.isDestroyed()) win.close();
      }
      resolve(region);
    };

    const onConfirm = (_event: IpcMainEvent, payload: unknown): void => {
      // Rule: validate every IPC payload on the main side.
      const parsed = ConfirmPayload.safeParse(payload);
      if (!parsed.success) {
        finish(null);
        return;
      }
      const { displayId, rect } = parsed.data;
      const display = displays.find((d) => d.id === displayId);
      if (!display) {
        finish(null);
        return;
      }
      finish({
        // Overlay-local DIP -> virtual-desktop DIP (pure + unit-tested).
        rect: overlayRectToVirtual(rect, display.bounds),
        displayId: display.id,
        updatedAt: new Date().toISOString(),
      });
    };

    const onCancel = (): void => finish(null);

    /**
     * A drag started on one overlay: clear any selection the user left on the
     * others, so only one rectangle exists across all monitors at a time.
     */
    const onBegin = (event: IpcMainEvent): void => {
      for (const win of overlayWindows) {
        if (win.isDestroyed() || win.webContents.id === event.sender.id) continue;
        win.webContents.send('overlay:clear');
      }
    };

    ipcMain.on('overlay:confirm', onConfirm);
    ipcMain.on('overlay:cancel', onCancel);
    ipcMain.on('overlay:begin', onBegin);

    overlayWindows = displays.map((display) => createOverlayWindow(display, finish));
  });
}

/** One transparent, click-through-free overlay covering exactly one display. */
function createOverlayWindow(
  display: DisplayInfo,
  onClosed: (region: SavedRegion | null) => void,
): BrowserWindow {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/overlay.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Windows can place a frameless window a few pixels off its requested origin
  // at creation; re-assert the exact display bounds so the overlay lines up with
  // the monitor it is meant to cover (the whole display, taskbar included).
  win.setBounds(display.bounds);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  void (rendererUrl
    ? win.loadURL(`${rendererUrl}/overlay.html`)
    : win.loadFile(join(__dirname, '../renderer/overlay.html')));

  win.webContents.once('did-finish-load', () => {
    win.webContents.send('overlay:init', { display });
  });

  // Closing any overlay (alt-F4, display unplugged) cancels the whole selection.
  win.on('closed', () => onClosed(null));
  return win;
}
