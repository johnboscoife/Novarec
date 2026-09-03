/**
 * Combines a screen and a camera into ONE video track, camera picture-in-picture.
 *
 * Single-file recording writes one muxed file, so it can carry exactly one video
 * track. With both a screen and a phone camera acquired, taking "the first" one
 * silently threw the other away — the camera appeared to be recording and simply
 * was not in the file. Compositing at capture time is the only way one track can
 * hold both.
 *
 * The layout matches what the export compositor does for separate-track
 * recordings (camera bottom-right, one sixth of the width), so a take looks the
 * same whichever mode produced it.
 */
const PIP_WIDTH_FRACTION = 1 / 6;
const PIP_MARGIN_FRACTION = 0.0125;
/** Cap the canvas so compositing a 4K screen doesn't stall a modest machine. */
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;

function toEven(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

/** Attach hidden: a detached <video> can have its frames throttled. */
function hiddenVideo(stream: MediaStream): HTMLVideoElement {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.style.cssText =
    'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0;pointer-events:none;';
  video.setAttribute('aria-hidden', 'true');
  document.body.appendChild(video);
  return video;
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
        reject(new Error('A camera never produced a frame to composite'));
        return;
      }
      requestAnimationFrame(check);
    };
    video.addEventListener('loadedmetadata', check, { once: true });
    void video.play().catch(() => undefined);
    check();
  });
}

export class CompositedVideoStream {
  private timer: number | null = null;
  private stopped = false;

  private constructor(
    private readonly videos: HTMLVideoElement[],
    readonly stream: MediaStream,
  ) {}

  /**
   * Draw `base` full-frame with `overlay` in the corner.
   *
   * The source streams are BORROWED, not owned: the recorder opened them and
   * closes them. Closing a borrowed stream here would kill a paired phone's
   * camera the first time a recording stopped.
   */
  static async create(
    base: MediaStream,
    overlay: MediaStream,
    fps: number,
  ): Promise<CompositedVideoStream> {
    const baseVideo = hiddenVideo(base);
    const overlayVideo = hiddenVideo(overlay);
    try {
      await waitForFrameSize(baseVideo);
      await waitForFrameSize(overlayVideo);
    } catch (error) {
      // Leave the sources alone — the caller still needs them to fall back to.
      baseVideo.remove();
      overlayVideo.remove();
      throw error;
    }

    const scale = Math.min(1, MAX_WIDTH / baseVideo.videoWidth, MAX_HEIGHT / baseVideo.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = toEven(baseVideo.videoWidth * scale);
    canvas.height = toEven(baseVideo.videoHeight * scale);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      baseVideo.remove();
      overlayVideo.remove();
      throw new Error('Could not prepare the camera overlay (2D canvas unavailable)');
    }

    const composited = new CompositedVideoStream(
      [baseVideo, overlayVideo],
      canvas.captureStream(fps),
    );
    composited.pump(ctx, canvas, baseVideo, overlayVideo, fps);
    return composited;
  }

  /**
   * Redraw on a steady tick rather than per source frame: screen capture only
   * emits on change, and `captureStream` only emits when the canvas changes, so
   * a still screen would otherwise produce no video at all.
   */
  private pump(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    base: HTMLVideoElement,
    overlay: HTMLVideoElement,
    fps: number,
  ): void {
    const periodMs = Math.max(1, Math.round(1000 / Math.max(1, fps)));
    const draw = (): void => {
      if (this.stopped) return;
      ctx.drawImage(base, 0, 0, canvas.width, canvas.height);

      // Preserve the camera's aspect ratio; a squashed face is worse than a
      // slightly smaller one.
      const width = Math.round(canvas.width * PIP_WIDTH_FRACTION);
      const aspect = overlay.videoWidth / Math.max(1, overlay.videoHeight);
      const height = Math.round(width / (aspect || 1));
      const margin = Math.round(canvas.width * PIP_MARGIN_FRACTION);
      ctx.drawImage(
        overlay,
        canvas.width - width - margin,
        canvas.height - height - margin,
        width,
        height,
      );
    };

    void base.play().catch(() => undefined);
    void overlay.play().catch(() => undefined);
    draw();
    this.timer = window.setInterval(draw, periodMs);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    // Only the canvas stream is ours; the sources belong to the recorder.
    this.stream.getTracks().forEach((t) => t.stop());
    this.videos.forEach((v) => {
      v.pause();
      v.srcObject = null;
      v.remove();
    });
  }
}
