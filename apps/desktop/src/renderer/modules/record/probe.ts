import { computeProbeMetrics, maxSustainableFps, type ProbeMetrics } from '@novarec/capture';
import { SUPPORTED_TARGET_FPS } from '@novarec/shared';

/**
 * Runs a short capture probe and reports what FPS the machine can sustain.
 *
 * Design note: this diagnostic counts delivered frames on the render thread via
 * `requestVideoFrameCallback` — cheap and accurate for a 3-second measurement.
 * The *recording* hot path (Phase 2/3) moves capture + encode off the UI thread
 * into a worker (WebCodecs / MediaStreamTrackProcessor); a one-off probe does
 * not warrant that machinery. See ADR-0003.
 */
export interface ProbeResult {
  metrics: ProbeMetrics;
  maxSustainableFps: number;
  timestamps: number[];
}

/** Electron's desktopCapturer constraints are non-standard (chromeMediaSource). */
interface DesktopVideoConstraints {
  mandatory: {
    chromeMediaSource: 'desktop';
    chromeMediaSourceId: string;
    maxFrameRate?: number;
  };
}

interface RvfcVideo {
  requestVideoFrameCallback(callback: (now: number) => void): number;
}

export async function runSustainProbe(
  sourceId: string,
  targetFps: number,
  durationMs = 3000,
): Promise<ProbeResult> {
  const constraints: DesktopVideoConstraints = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      maxFrameRate: targetFps,
    },
  };

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: constraints as unknown as MediaTrackConstraints,
  });

  try {
    const timestamps = await collectFrameTimestamps(stream, durationMs);
    return {
      metrics: computeProbeMetrics(timestamps, targetFps),
      maxSustainableFps: maxSustainableFps(timestamps, SUPPORTED_TARGET_FPS, targetFps),
      timestamps,
    };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

function collectFrameTimestamps(stream: MediaStream, durationMs: number): Promise<number[]> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;

    const timestamps: number[] = [];
    let startAt = 0;
    const hasRvfc = 'requestVideoFrameCallback' in video;

    const onFrame = (now: number): void => {
      if (startAt === 0) startAt = now;
      timestamps.push(now);
      if (now - startAt >= durationMs) {
        resolve(timestamps);
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
        if (t - start >= durationMs) resolve(timestamps);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
}
