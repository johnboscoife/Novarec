import { computeProbeMetrics, maxSustainableFps, type ProbeMetrics } from '@novarec/capture';
import { SUPPORTED_TARGET_FPS } from '@novarec/shared';

/**
 * Runs a short capture probe and reports what FPS the machine can sustain.
 *
 * Two subtleties this handles, both learned the hard way:
 *
 *  1. **Screen capture is change-driven.** Chromium's `getDisplayMedia` screen
 *     capturer only emits a frame when the screen content changes. A perfectly
 *     capable machine looking at a static panel therefore delivers ~0 fps — not
 *     a real limit. We drive steady on-screen motion for the duration so the
 *     probe measures true *sustainable capacity*, not an idle screen.
 *
 *  2. **Hidden `<video>` frame callbacks are throttled.** `requestVideoFrameCallback`
 *     on an occluded/invisible element is rate-limited by the compositor, which
 *     under-counts frames. We read real captured frames straight off the track
 *     via `MediaStreamTrackProcessor`, which is immune to that. A `<video>` +
 *     rVFC path remains as a fallback for engines without the processor.
 *
 * The *recording* hot path (Phase 2/3) encodes off the UI thread in Chromium's
 * media pipeline; a one-off diagnostic does not warrant that machinery. See
 * ADR-0003.
 */
export interface ProbeResult {
  metrics: ProbeMetrics;
  maxSustainableFps: number;
  timestamps: number[];
}

interface RvfcVideo {
  requestVideoFrameCallback(callback: (now: number) => void): number;
}

/** Minimal shape of `MediaStreamTrackProcessor` (not yet in the TS DOM lib). */
interface TrackProcessor {
  readable: ReadableStream<{ close(): void }>;
}
interface TrackProcessorCtor {
  new (init: { track: MediaStreamTrack }): TrackProcessor;
}

export async function runSustainProbe(
  sourceId: string,
  targetFps: number,
  durationMs = 3000,
): Promise<ProbeResult> {
  await window.novarec.setCaptureSource({ sourceId, audio: false });
  // Drive motion on the *captured* display (may differ from NovaRec's own), so a
  // secondary screen isn't measured as static. Harmless for window sources.
  await window.novarec.setProbeMotion({ on: true, sourceId }).catch(() => undefined);
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: targetFps },
    audio: false,
  });

  // Also animate inside our own window — covers the case of capturing NovaRec
  // itself (a window source), which the display overlay can't reach.
  const stopMotion = startMotionDriver();
  try {
    const timestamps = await collectFrameTimestamps(stream, durationMs);
    return {
      metrics: computeProbeMetrics(timestamps, targetFps),
      maxSustainableFps: maxSustainableFps(timestamps, SUPPORTED_TARGET_FPS, targetFps),
      timestamps,
    };
  } finally {
    stopMotion();
    await window.novarec.setProbeMotion({ on: false, sourceId: null }).catch(() => undefined);
    stream.getTracks().forEach((t) => t.stop());
  }
}

/**
 * Paints a thin, continuously animating bar at the top of the screen so the
 * desktop capturer sees constant change and delivers at its target rate.
 * Returns a teardown function.
 */
function startMotionDriver(): () => void {
  const bar = document.createElement('div');
  bar.setAttribute('aria-hidden', 'true');
  bar.style.cssText =
    'position:fixed;top:0;left:0;right:0;height:3px;z-index:2147483647;pointer-events:none;' +
    'background:linear-gradient(90deg,#3b5bff,#7c5cff,#3b5bff);background-size:200% 100%;';
  document.body.appendChild(bar);

  let raf = 0;
  let offset = 0;
  const tick = (): void => {
    offset = (offset + 8) % 200;
    bar.style.backgroundPosition = `${offset}% 0`;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    bar.remove();
  };
}

async function collectFrameTimestamps(stream: MediaStream, durationMs: number): Promise<number[]> {
  const track = stream.getVideoTracks()[0];
  const Ctor = (window as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor })
    .MediaStreamTrackProcessor;
  if (track && Ctor) {
    return collectViaProcessor(new Ctor({ track }), durationMs);
  }
  return collectViaVideo(stream, durationMs);
}

/** Accurate path: count real captured frames off the track. */
async function collectViaProcessor(
  processor: TrackProcessor,
  durationMs: number,
): Promise<number[]> {
  const reader = processor.readable.getReader();
  const timestamps: number[] = [];
  let firstAt = 0;
  // Guard a fully static source: if frames never arrive, cancel so we don't
  // hang past the probe window.
  const guard = setTimeout(() => void reader.cancel().catch(() => undefined), durationMs + 500);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const now = performance.now();
      value.close();
      if (firstAt === 0) firstAt = now;
      timestamps.push(now);
      if (now - firstAt >= durationMs) break;
    }
  } finally {
    clearTimeout(guard);
    void reader.cancel().catch(() => undefined);
  }
  return timestamps;
}

/** Fallback path: attached hidden `<video>` + requestVideoFrameCallback. */
function collectViaVideo(stream: MediaStream, durationMs: number): Promise<number[]> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    // A detached video may not present frames (throttling rVFC and under-
    // reporting fps). Attach it hidden so the reading reflects real capture.
    video.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;';
    document.body.appendChild(video);

    const timestamps: number[] = [];
    let startAt = 0;
    const hasRvfc = 'requestVideoFrameCallback' in video;

    const finish = (): void => {
      video.remove();
      resolve(timestamps);
    };

    const onFrame = (now: number): void => {
      if (startAt === 0) startAt = now;
      timestamps.push(now);
      if (now - startAt >= durationMs) {
        finish();
        return;
      }
      (video as unknown as RvfcVideo).requestVideoFrameCallback(onFrame);
    };

    void video.play().then(() => {
      if (hasRvfc) {
        (video as unknown as RvfcVideo).requestVideoFrameCallback(onFrame);
        return;
      }
      // Fallback for engines without requestVideoFrameCallback.
      const start = performance.now();
      const tick = (): void => {
        const t = performance.now();
        timestamps.push(t);
        if (t - start >= durationMs) finish();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
}
