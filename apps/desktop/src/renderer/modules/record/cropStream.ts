import { cropForRegion, type RegionCrop } from '@novarec/capture';
import type { Rect } from '@novarec/shared';

/**
 * Applies a picked screen region to a live capture.
 *
 * `getDisplayMedia` always hands back a whole display — there is no crop
 * constraint that Chromium honours for desktop capture. So the region is applied
 * here: the captured frames are drawn, cropped, onto a canvas, and the canvas's
 * own `captureStream` is what the MediaRecorder encodes. The recording is
 * therefore cropped at the source; nothing downstream (finalize, export) needs
 * to know a region was used.
 *
 * The canvas is redrawn on a STEADY tick at the target frame rate, not once per
 * delivered source frame. Screen capture is change-driven — Chromium emits a
 * frame only when the picture changes — and `canvas.captureStream()` emits a
 * frame only when the canvas is modified. Chaining those two means a still
 * screen produces no canvas frames at all, so the recorder receives no data and
 * the take has a hole in it. Redrawing the current frame on a timer costs one
 * `drawImage` per tick and makes a still screen record as still video, which is
 * what it actually is.
 */
export interface RegionSpec {
  /** The picked region, in DIP virtual-desktop coordinates. */
  rect: Rect;
  /** DIP bounds of the display being captured. */
  displayBounds: Rect;
}

export class CroppedScreenStream {
  private timer: number | null = null;
  private stopped = false;

  private constructor(
    private readonly source: MediaStream,
    private readonly video: HTMLVideoElement,
    private readonly canvas: HTMLCanvasElement,
    readonly stream: MediaStream,
  ) {}

  /**
   * Wrap `source` so only `spec`'s region is recorded. Resolves with null when
   * the region turns out to be a no-op (it covers the whole captured display) —
   * the caller then records the source directly rather than paying for a canvas
   * pass. Rejects if the region does not overlap the captured display at all,
   * which must surface as an error instead of silently recording everything.
   */
  static async create(
    source: MediaStream,
    spec: RegionSpec,
    fps: number,
  ): Promise<CroppedScreenStream | null> {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = source;
    // A detached <video> can have its frame callbacks throttled by the
    // compositor, which would starve the crop. Attach it hidden instead.
    video.style.cssText =
      'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    video.setAttribute('aria-hidden', 'true');
    document.body.appendChild(video);

    let crop: RegionCrop | null;
    try {
      await waitForFrameSize(video);
      crop = cropForRegion(spec.rect, spec.displayBounds, video.videoWidth, video.videoHeight);
      if (!crop) {
        // Either the region is the whole display, or it misses it entirely —
        // tell those apart so only the genuine no-op falls through uncropped.
        const overlaps = overlapsDisplay(spec);
        video.remove();
        if (overlaps) return null;
        throw new Error(
          'The selected area is not on the screen being captured — pick the area again.',
        );
      }
    } catch (error) {
      // The caller can't use `source` after a failure, and an abandoned display
      // capture keeps the OS "sharing your screen" state alive — stop it here.
      video.remove();
      source.getTracks().forEach((t) => t.stop());
      throw error;
    }

    const canvas = document.createElement('canvas');
    canvas.width = crop.outWidth;
    canvas.height = crop.outHeight;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      video.remove();
      source.getTracks().forEach((t) => t.stop());
      throw new Error('Could not prepare the region crop (2D canvas unavailable)');
    }

    const stream = canvas.captureStream(fps);
    const cropped = new CroppedScreenStream(source, video, canvas, stream);
    cropped.pump(ctx, crop, fps);
    return cropped;
  }

  /**
   * Redraw the cropped rect at the target rate until stopped. A timer (not
   * rAF/rVFC) because it must keep running while NovaRec is unfocused or
   * minimized mid-recording; the window sets `backgroundThrottling: false` so
   * these ticks are not throttled.
   */
  private pump(ctx: CanvasRenderingContext2D, crop: RegionCrop, fps: number): void {
    const periodMs = Math.max(1, Math.round(1000 / Math.max(1, fps)));
    const draw = (): void => {
      if (this.stopped) return;
      ctx.drawImage(
        this.video,
        crop.sx,
        crop.sy,
        crop.sw,
        crop.sh,
        0,
        0,
        this.canvas.width,
        this.canvas.height,
      );
    };

    void this.video.play().catch(() => undefined);
    draw(); // paint frame 0 immediately so the stream starts with real content
    this.timer = window.setInterval(draw, periodMs);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.stream.getTracks().forEach((t) => t.stop());
    this.source.getTracks().forEach((t) => t.stop());
    this.video.pause();
    this.video.srcObject = null;
    this.video.remove();
  }
}

/** Does the picked region touch the display we are capturing at all? */
function overlapsDisplay({ rect, displayBounds }: RegionSpec): boolean {
  return (
    rect.x < displayBounds.x + displayBounds.width &&
    rect.x + rect.width > displayBounds.x &&
    rect.y < displayBounds.y + displayBounds.height &&
    rect.y + rect.height > displayBounds.y
  );
}

/**
 * Resolve once the capture has a real frame size. `loadedmetadata` can fire with
 * 0x0 for a desktop capture that has not produced a frame yet, so poll briefly
 * rather than trusting the first event.
 */
function waitForFrameSize(video: HTMLVideoElement, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const check = (): void => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        resolve();
        return;
      }
      if (performance.now() - startedAt > timeoutMs) {
        reject(new Error('The screen capture never produced a frame to crop'));
        return;
      }
      requestAnimationFrame(check);
    };
    video.addEventListener('loadedmetadata', check, { once: true });
    void video.play().catch(() => undefined);
    check();
  });
}
