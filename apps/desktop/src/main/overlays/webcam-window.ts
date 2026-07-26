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
interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WebcamConfig {
  deviceId: string | null;
  shape: WebcamShape;
  sizePx: number;
  displayBounds?: Bounds | null;
}

/** Keep a size×size window fully inside `area`, anchored bottom-right by default. */
function placeInside(area: Bounds, size: number): { x: number; y: number } {
  return {
    x: Math.round(area.x + area.width - size - 40),
    y: Math.round(area.y + area.height - size - 96),
  };
}

function isInside(area: Bounds, x: number, y: number, size: number): boolean {
  return (
    x >= area.x &&
    y >= area.y &&
    x + size <= area.x + area.width &&
    y + size <= area.y + area.height
  );
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
  const captured = config.displayBounds ?? null;

  if (overlay && !overlay.isDestroyed()) {
    let [x = 0, y = 0] = overlay.getPosition();
    // If we're now capturing a different monitor and the overlay isn't on it,
    // pull it onto the captured display — otherwise it won't be in the recording.
    if (captured && !isInside(captured, x, y, size)) {
      ({ x, y } = placeInside(captured, size));
      lastPosition = { x, y };
    }
    overlay.setBounds({ x, y, width: size, height: size });
    overlay.webContents.send('webcam:config', config);
    return;
  }

  // Open on the captured display if known, else the primary work area.
  const area = captured ?? screen.getPrimaryDisplay().workArea;
  const onCaptured =
    lastPosition && isInside(area, lastPosition.x, lastPosition.y, size) ? lastPosition : null;
  const position = onCaptured ?? placeInside(area, size);

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
