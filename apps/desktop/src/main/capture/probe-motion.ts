import { BrowserWindow, desktopCapturer, screen } from 'electron';

/**
 * Capacity-probe motion overlay.
 *
 * Screen capture is change-driven: `getDisplayMedia` only emits a frame when the
 * captured picture changes, so probing a still screen reads as ~0 fps. The Record
 * view paints an animated bar to force change — but that bar lives in NovaRec's
 * own window and therefore only covers the display NovaRec sits on. To measure a
 * *different* display fairly, we open a tiny transparent, click-through,
 * always-on-top window on that display and animate it. The desktop capturer sees
 * constant change and delivers at its true rate.
 */

const MOTION_HTML =
  'data:text/html,' +
  encodeURIComponent(
    '<!doctype html><meta charset="utf-8">' +
      '<style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}' +
      '#b{position:fixed;inset:0;background:linear-gradient(90deg,#3b5bff,#7c5cff,#3b5bff);' +
      'background-size:200% 100%}</style>' +
      '<div id="b"></div>' +
      '<script>var o=0,e=document.getElementById("b");' +
      'function t(){o=(o+8)%200;e.style.backgroundPosition=o+"% 0";requestAnimationFrame(t)}' +
      'requestAnimationFrame(t);</script>',
  );

let overlay: BrowserWindow | null = null;

async function boundsForSource(
  sourceId: string,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 },
  });
  const source = sources.find((s) => s.id === sourceId);
  if (!source) return null;
  const display =
    screen.getAllDisplays().find((d) => String(d.id) === source.display_id) ??
    screen.getPrimaryDisplay();
  return display.bounds;
}

/**
 * Show the animated overlay on the display backing `sourceId`. Only screen
 * sources can be driven this way (a window source can't be forced to repaint);
 * for those we no-op and rely on the renderer's in-window bar.
 */
export async function startProbeMotion(sourceId: string | null): Promise<void> {
  stopProbeMotion();
  if (!sourceId || !sourceId.startsWith('screen:')) return;

  const bounds = await boundsForSource(sourceId);
  if (!bounds) return;

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: 8,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
  });
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  await win.loadURL(MOTION_HTML);
  if (win.isDestroyed()) return;
  win.showInactive();
  overlay = win;
}

export function stopProbeMotion(): void {
  if (overlay && !overlay.isDestroyed()) overlay.close();
  overlay = null;
}
