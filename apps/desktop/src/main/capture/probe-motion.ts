import { BrowserWindow } from 'electron';

/**
 * Capacity-probe motion overlay.
 *
 * Screen capture is change-driven: `getDisplayMedia` only emits a frame when the
 * captured picture changes, so probing a still screen reads as ~0 fps. The Record
 * view paints an animated bar to force change — but that bar lives in NovaRec's
 * own window and therefore only covers the display NovaRec sits on. To measure a
 * *different* display fairly, we animate a bar there too.
 *
 * The renderer already maps each screen source to a display (it shows per-screen
 * DPI/bounds), so it passes the target display's DIP bounds directly — we do NOT
 * re-derive them from `DesktopCapturerSource.display_id`, which is unreliable on
 * Windows. The overlay is a thin, opaque, click-through, always-on-top strip: the
 * same kind of visible animated element that already drives the primary display
 * to full rate. Opaque (not transparent) so it reliably registers as screen
 * change for the capturer.
 */

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const STRIP_HEIGHT = 6;

const MOTION_HTML =
  'data:text/html,' +
  encodeURIComponent(
    '<!doctype html><meta charset="utf-8">' +
      '<style>html,body{margin:0;height:100%;overflow:hidden;background:#0b0b0f}' +
      '#b{position:fixed;inset:0;background:linear-gradient(90deg,#3b5bff,#7c5cff,#3b5bff);' +
      'background-size:200% 100%}</style>' +
      '<div id="b"></div>' +
      '<script>var o=0,e=document.getElementById("b");' +
      'function t(){o=(o+8)%200;e.style.backgroundPosition=o+"% 0";requestAnimationFrame(t)}' +
      'requestAnimationFrame(t);</script>',
  );

let overlay: BrowserWindow | null = null;

/** Show the animated strip at the top of the given display bounds (DIP). */
export async function startProbeMotion(bounds: Bounds | null): Promise<void> {
  stopProbeMotion();
  if (!bounds) return;

  const win = new BrowserWindow({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: STRIP_HEIGHT,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#0b0b0f',
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
