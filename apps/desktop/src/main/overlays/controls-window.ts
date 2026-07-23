import { join } from 'node:path';
import { app, BrowserWindow, nativeImage, Tray } from 'electron';
import type { ControlAction, RecordControlState } from '@novarec/shared';

/**
 * Floating recording control: a small always-on-top pill with pause/resume,
 * stop, mute-mic, toggle-webcam and dismiss. Unlike the webcam overlay this one
 * is content-protected, so it stays OUT of the recording. Commands are routed to
 * the "host" (main) window that actually owns the recorder; state flows back the
 * other way. Dismissing hides the pill and drops a tray icon to bring it back.
 */
const isDev = !app.isPackaged;

// Small self-contained tray icon (blue rounded square + record dot) so there's
// no runtime asset path to resolve inside the packaged app.
const TRAY_ICON_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACgElEQVR4nO2XT2gTQRTG38SoNMmmKQTa' +
  'i6KUBDwZr/Wk9KyJF4+2NEIriPVkUTDGg/RmRKQFlSjtxYu0noOe7LXxJFSKopdiCs2/TbHGjN/bTWp' +
  'MoDsLu8mlP5jdb+aw75uZ93Z3BLURm90J1ar1W5IoTpJiGHIOQXkEW/EFvE/ymaEiRgwwZhK5vj1BDf' +
  'kYMoTmJkXyiNtfnodfETAMNINnIXuHR0yyCcHLrlfqXzHk9sw7Kfo172kRTRYeSEkpDPQcISgtIsnCuu' +
  'MJpwonZmSqICH7xqEB2waCPkHXxgdoPHaMzpz0YoTo8/c65fJ79Dq3S+WarcfZM3Dl/HG6e9UPEx70ui' +
  'nXGvTojU5vP/5CTw1lAxx8flKDsmYuW1E2oWSAl/39/BDu5swbW1u0u7hIfzY30SM6MjpKA9PT5BkZQc' +
  '9ciYtzO7hbPlrNwM1LPqMxHLwyM0OyWkXvHyIQIG1hYd/E03c1o1mhZGD1fmg/4fRUin6vrUF1c3RsjP' +
  'zpNJSZmJcfFqEORsnAxoswrialRKJr9i149sGlJSiTaHIb14OxbyCOXwVdh+rGMzxMweVlKBPHDKymsA' +
  'UnvFA2tuAHtiDt0BZwAnJjjCRExneugvD7SUNl8DYwnIDcrFAywGX4AWWotZchMv6/MkRltIJXUIYXnCx' +
  'Dxs6L6MazMuXW96CsUTbAsIl7eBW3VqITnvmdbFU5OGPLAMPbYXyMzuFj1ExMTjgO6vrHyA0ODYjo1M+' +
  '8JHEWuucIkp/6/1vePJh8I6JBtF5SwsHklIDoy9FMkEhsvAyvGAaYpokM5CCam5QQfIKDQ8NIG7wdOJ7' +
  'PkpRxpxOTEw6bzsfzTPvx/C/LZSvGyWHwzQAAAABJRU5ErkJggg==';

let controls: BrowserWindow | null = null;
let tray: Tray | null = null;
let host: BrowserWindow | null = null;

/** The window that owns the recorder — commands are routed to it. */
export function setHostWindow(win: BrowserWindow): void {
  host = win;
}

function loadOverlayRoute(win: BrowserWindow): void {
  const search = new URLSearchParams({ overlay: 'controls' }).toString();
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (isDev && devUrl) {
    void win.loadURL(`${devUrl}?${search}`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { search });
  }
}

function createControls(): BrowserWindow {
  const win = new BrowserWindow({
    width: 340,
    height: 68,
    useContentSize: true,
    frame: false,
    transparent: true,
    resizable: false,
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
  // Keep the control out of the screen recording.
  win.setContentProtection(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive();
  });
  win.on('closed', () => {
    controls = null;
  });
  loadOverlayRoute(win);
  return win;
}

export function showControls(): void {
  destroyTray();
  if (!controls || controls.isDestroyed()) {
    controls = createControls();
  } else {
    controls.showInactive();
  }
}

export function hideControls(): void {
  destroyTray();
  if (controls && !controls.isDestroyed()) controls.close();
  controls = null;
}

export function dispatchCommand(action: ControlAction): void {
  if (action === 'dismiss') {
    if (controls && !controls.isDestroyed()) controls.hide();
    showTray();
    return;
  }
  if (host && !host.isDestroyed()) host.webContents.send('controls:action', action);
}

export function pushControlState(state: RecordControlState): void {
  if (controls && !controls.isDestroyed()) {
    controls.webContents.send('controls:state-update', state);
  }
}

function showTray(): void {
  if (tray) return;
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_PNG}`);
  tray = new Tray(icon);
  tray.setToolTip('NovaRec is recording — click to show controls');
  tray.on('click', () => {
    if (controls && !controls.isDestroyed()) controls.showInactive();
    destroyTray();
  });
}

function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
