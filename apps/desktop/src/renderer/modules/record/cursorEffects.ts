import {
  activeRipples,
  easePoint,
  easeValue,
  projectPoint,
  pruneClicks,
  zoomedSourceRect,
  type ClickMark,
  type Point,
} from '@novarec/overlay';
import type { Rect } from '@novarec/shared';

/**
 * Draws the screen with live cursor effects: zoom toward the pointer, a
 * highlight ring, click ripples, and a smoothed synthetic pointer.
 *
 * Everything here is baked into the recording, so it runs on the capture path
 * rather than as a preview. The geometry and easing live in `@novarec/overlay`
 * where they are unit-tested; this file owns only the drawing and the plumbing.
 */
export interface CursorEffectsOptions {
  /** DIP bounds of the display being captured — pointer samples arrive in DIP. */
  displayBounds: Rect;
  fps: number;
  zoomScale: number;
  highlight: boolean;
  clickEffects: boolean;
  /** Draw our own pointer, because the real one was left out of the capture. */
  drawCursor: boolean;
  smoothing: boolean;
  /** Called once if the effects have to be abandoned mid-recording. */
  onEffectsFailed?: () => void;
}

/** How quickly the zoom and the focus point catch up. */
const ZOOM_HALF_LIFE_MS = 140;
const FOCUS_HALF_LIFE_MS = 110;
/** Smoothing the pointer itself is gentler, or it lags behind the click. */
const CURSOR_HALF_LIFE_MS = 45;
const RIPPLE_MS = 450;
const RIPPLE_MAX_RADIUS = 44;
const RING_RADIUS = 26;

function toEven(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

export class CursorEffectsStream {
  private timer: number | null = null;
  private stopped = false;
  private offSample: (() => void) | null = null;

  /** Latest raw pointer position, in source-frame pixels. */
  private rawCursor: Point = { x: 0, y: 0 };
  private easedCursor: Point = { x: 0, y: 0 };
  private easedFocus: Point = { x: 0, y: 0 };
  private easedScale = 1;
  private targetScale = 1;
  private clicks: ClickMark[] = [];
  private lastDrawAt = 0;
  /** Effects are decorative; the recording is not. After repeated trouble the
   * effects are abandoned and the plain frame is drawn instead. */
  private failures = 0;
  private effectsDisabled = false;

  private constructor(
    private readonly video: HTMLVideoElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    private readonly options: CursorEffectsOptions,
    readonly stream: MediaStream,
  ) {}

  static async create(
    source: MediaStream,
    options: CursorEffectsOptions,
  ): Promise<CursorEffectsStream> {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = source;
    video.style.cssText =
      'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    video.setAttribute('aria-hidden', 'true');
    document.body.appendChild(video);

    try {
      await waitForFrameSize(video);
    } catch (error) {
      video.remove();
      throw error;
    }

    const canvas = document.createElement('canvas');
    canvas.width = toEven(video.videoWidth);
    canvas.height = toEven(video.videoHeight);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      video.remove();
      throw new Error('Could not prepare cursor effects (2D canvas unavailable)');
    }

    const effects = new CursorEffectsStream(
      video,
      canvas,
      ctx,
      options,
      canvas.captureStream(options.fps),
    );
    effects.start();
    return effects;
  }

  /** Zoom in toward the pointer, or back out. Eased, never a jump cut. */
  setZoomed(zoomed: boolean): void {
    this.targetScale = zoomed ? Math.max(1, this.options.zoomScale) : 1;
  }

  get zoomed(): boolean {
    return this.targetScale > 1;
  }

  private start(): void {
    const { displayBounds } = this.options;
    // Pointer samples are DIP on the virtual desktop; the frame is this display
    // in its own pixels. Same mapping the region crop uses.
    const scaleX = this.canvas.width / Math.max(1, displayBounds.width);
    const scaleY = this.canvas.height / Math.max(1, displayBounds.height);

    this.offSample = window.novarec.onCursorSample((sample) => {
      const point = {
        x: (sample.x - displayBounds.x) * scaleX,
        y: (sample.y - displayBounds.y) * scaleY,
      };
      this.rawCursor = point;
      if (sample.clicked && this.options.clickEffects) {
        this.clicks.push({ atMs: performance.now(), x: point.x, y: point.y });
      }
    });

    this.easedCursor = this.rawCursor;
    this.easedFocus = this.rawCursor;
    this.lastDrawAt = performance.now();

    const periodMs = Math.max(1, Math.round(1000 / Math.max(1, this.options.fps)));
    void this.video.play().catch(() => undefined);
    this.draw();
    this.timer = window.setInterval(() => this.draw(), periodMs);
  }

  /**
   * Draw one frame. Wrapped so that nothing here can stop the loop: this canvas
   * IS the recording, and a decorative effect must never be able to freeze it.
   */
  private draw(): void {
    if (this.stopped) return;
    try {
      this.drawFrame();
      this.failures = 0;
    } catch {
      this.failures += 1;
      if (this.failures >= 5 && !this.effectsDisabled) {
        this.effectsDisabled = true;
        this.options.onEffectsFailed?.();
      }
      this.drawPlainFrame();
    }
  }

  /** Last resort: the untouched frame, so the recording keeps moving. */
  private drawPlainFrame(): void {
    try {
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    } catch {
      // Nothing further to try; the next tick will attempt again.
    }
  }

  private drawFrame(): void {
    const now = performance.now();
    const dt = Math.max(1, now - this.lastDrawAt);
    this.lastDrawAt = now;

    const { ctx, canvas, options } = this;
    if (this.effectsDisabled) {
      this.drawPlainFrame();
      return;
    }

    this.easedScale = easeValue(this.easedScale, this.targetScale, dt, ZOOM_HALF_LIFE_MS);
    this.easedFocus = easePoint(this.easedFocus, this.rawCursor, dt, FOCUS_HALF_LIFE_MS);
    this.easedCursor = options.smoothing
      ? easePoint(this.easedCursor, this.rawCursor, dt, CURSOR_HALF_LIFE_MS)
      : this.rawCursor;

    const view = zoomedSourceRect(canvas.width, canvas.height, this.easedFocus, this.easedScale);
    // `drawImage` given a degenerate rect draws NOTHING and throws nothing, so
    // the canvas would silently stop updating and freeze the recording. The
    // geometry is total now; this is the second line of defence.
    if (view.width <= 0 || view.height <= 0) {
      this.drawPlainFrame();
      return;
    }
    ctx.drawImage(
      this.video,
      view.x,
      view.y,
      view.width,
      view.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    // Effects are drawn in the FRAME's space, so they travel with the picture
    // as it zooms rather than floating over it.
    const zoom = canvas.width / view.width;
    const at = projectPoint(this.easedCursor, view, canvas.width, canvas.height);

    if (options.clickEffects) {
      this.clicks = pruneClicks(this.clicks, now, RIPPLE_MS);
      for (const ripple of activeRipples(this.clicks, now, RIPPLE_MS)) {
        const centre = projectPoint(ripple, view, canvas.width, canvas.height);
        ctx.beginPath();
        ctx.arc(centre.x, centre.y, ripple.progress * RIPPLE_MAX_RADIUS * zoom, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(59,130,246,${String(ripple.opacity)})`;
        ctx.lineWidth = Math.max(1, 3 * zoom);
        ctx.stroke();
      }
    }

    if (options.highlight) {
      ctx.beginPath();
      ctx.arc(at.x, at.y, RING_RADIUS * zoom, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(250,204,21,0.18)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(250,204,21,0.55)';
      ctx.lineWidth = Math.max(1, 2 * zoom);
      ctx.stroke();
    }

    if (options.drawCursor) this.drawPointer(at, zoom);
  }

  /** A plain arrow, drawn because the real pointer was excluded from capture. */
  private drawPointer(at: Point, zoom: number): void {
    const { ctx } = this;
    const s = 18 * zoom;
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, s);
    ctx.lineTo(s * 0.28, s * 0.76);
    ctx.lineTo(s * 0.46, s * 1.12);
    ctx.lineTo(s * 0.63, s * 1.04);
    ctx.lineTo(s * 0.45, s * 0.68);
    ctx.lineTo(s * 0.72, s * 0.66);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = Math.max(1, 1.5 * zoom);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.offSample?.();
    this.offSample = null;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    // Only the canvas stream is ours; the source belongs to the recorder.
    this.stream.getTracks().forEach((t) => t.stop());
    this.video.pause();
    this.video.srcObject = null;
    this.video.remove();
  }
}

function waitForFrameSize(video: HTMLVideoElement, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const check = (): void => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        resolve();
        return;
      }
      if (performance.now() - startedAt > timeoutMs) {
        reject(new Error('The screen capture never produced a frame'));
        return;
      }
      requestAnimationFrame(check);
    };
    video.addEventListener('loadedmetadata', check, { once: true });
    void video.play().catch(() => undefined);
    check();
  });
}
