import { join } from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import type { WebcamShape } from '@novarec/shared';

/**
 * Floating webcam overlay window. A transparent, always-on-top, draggable and
 * resizable window that shows the live camera clipped to the chosen shape. It
 * deliberately is NOT content-protected: the screen recorder captures it, so the
 * webcam ends up baked into the recording exactly where, how big, and what shape
 * the user left it — the export matches for free, even if it was moved mid-take.
 */
interface WebcamConfig {
  deviceId: string | null;
  shape: WebcamShape;
  sizePx: number;
}

const isDev = !app.isPackaged;
const MIN_SIZE = 120;
const MAX_SIZE = 960;

let overlay: BrowserWindow | null = null;
let lastPosition: { x: number; y: number } | null = null;

function loadOverlayRoute(win: BrowserWindow, params: Record<string, string>): void {
  const search = new URLSearchParams({ overlay: 'webcam', ...params }).toString();
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (isDev && devUrl) {
    void win.loadURL(`${devUrl}?${search}`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { search });
  }
}

export function showWebcam(config: WebcamConfig): void {
  const size = Math.round(Math.max(MIN_SIZE, Math.min(MAX_SIZE, config.sizePx)));

  if (overlay && !overlay.isDestroyed()) {
    const [x = 0, y = 0] = overlay.getPosition();
    overlay.setBounds({ x, y, width: size, height: size });
    overlay.webContents.send('webcam:config', config);
    return;
  }

  const work = screen.getPrimaryDisplay().workArea;
  const position = lastPosition ?? {
    x: work.x + work.width - size - 40,
    y: work.y + work.height - size - 96,
  };

  const win = new BrowserWindow({
    x: position.x,
    y: position.y,
    width: size,
    height: size,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      backgroundThrottling: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.on('moved', () => {
    if (win.isDestroyed()) return;
    const [x = 0, y = 0] = win.getPosition();
    lastPosition = { x, y };
  });
  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.send('webcam:config', config);
  });
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive();
  });

  loadOverlayRoute(win, { deviceId: config.deviceId ?? '', shape: config.shape });
  overlay = win;
}

export function hideWebcam(): void {
  if (overlay && !overlay.isDestroyed()) overlay.close();
  overlay = null;
}
