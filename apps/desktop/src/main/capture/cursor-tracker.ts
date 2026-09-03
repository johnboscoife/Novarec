import { screen } from 'electron';

/**
 * Follows the pointer while recording, so the capture pipeline can zoom toward
 * it, ring it, and mark clicks.
 *
 * Position comes from Electron's `screen`, which reports DIP virtual-desktop
 * coordinates — the same space display bounds are in, so the renderer can map it
 * onto the captured frame with the arithmetic it already uses for region crop.
 *
 * Click TIMING comes from a global hook, but the click POSITION is read from
 * Electron at that instant rather than taken from the hook. The hook reports raw
 * physical pixels; mixing those with DIP puts every ripple in the wrong place on
 * a scaled display, which is most of them.
 */
export interface CursorSample {
  x: number;
  y: number;
  /** Set when a click landed since the previous sample. */
  clicked: boolean;
}

/** ~60Hz. Fast enough to look continuous, cheap enough to ignore. */
const SAMPLE_INTERVAL_MS = 16;

interface MouseHook {
  on(event: 'mousedown', handler: () => void): void;
  removeAllListeners(event: 'mousedown'): void;
  start(): void;
  stop(): void;
}

let timer: NodeJS.Timeout | null = null;
let hook: MouseHook | null = null;
let clickPending = false;

/**
 * Load the global mouse hook if it is available.
 *
 * Optional on purpose: it is a native module, and a build without a usable
 * prebuild must still record with every other cursor effect working rather than
 * failing to start.
 */
function loadHook(): MouseHook | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('uiohook-napi') as { uIOhook?: MouseHook };
    return mod.uIOhook ?? null;
  } catch {
    return null;
  }
}

/** True when click ripples can actually be produced on this machine. */
export function clickTrackingAvailable(): boolean {
  return loadHook() !== null;
}

export function startCursorTracking(onSample: (sample: CursorSample) => void): void {
  stopCursorTracking();

  hook = loadHook();
  if (hook) {
    try {
      hook.on('mousedown', () => {
        clickPending = true;
      });
      hook.start();
    } catch {
      // A hook that refuses to start (permissions, no display) must not stop a
      // recording — everything except click ripples still works.
      hook = null;
    }
  }

  timer = setInterval(() => {
    const point = screen.getCursorScreenPoint();
    const clicked = clickPending;
    clickPending = false;
    onSample({ x: point.x, y: point.y, clicked });
  }, SAMPLE_INTERVAL_MS);
}

export function stopCursorTracking(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (hook) {
    try {
      hook.removeAllListeners('mousedown');
      hook.stop();
    } catch {
      // Already stopped, or never really started.
    }
    hook = null;
  }
  clickPending = false;
}
