import { useEffect, useRef, useState } from 'react';
import { acquireDeviceStream } from './recorder.js';

/**
 * Live input level for a microphone, for the preview meter.
 *
 * The point of the meter is to answer "is this device actually hearing me?"
 * BEFORE a take is lost to a muted or wrong input, so it opens its own capture
 * of the device rather than tapping the recorder — it has to work when nothing
 * is recording. Windows opens microphones in shared mode, so this coexists with
 * a recording of the same device.
 */
export interface MicLevel {
  /** Smoothed level, 0..1, mapped from dBFS across `FLOOR_DB`..0. */
  level: number;
  /** Short-hold peak, 0..1 — catches transients the smoothed bar misses. */
  peak: number;
  /** Set when the device could not be opened at all. */
  error: string | null;
}

/** Below this, treat it as silence. Speech typically sits around -30..-12 dBFS. */
const FLOOR_DB = -60;
const SAMPLE_INTERVAL_MS = 50;
/** Peak falls back this much per sample once the input drops. */
const PEAK_DECAY = 0.04;
/** Exponential smoothing on the bar so it reads steadily instead of flickering. */
const SMOOTHING = 0.35;

function rmsToUnit(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  if (db <= FLOOR_DB) return 0;
  return Math.min(1, (db - FLOOR_DB) / -FLOOR_DB);
}

export function useMicLevel(deviceId: string | null, enabled: boolean): MicLevel {
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Held across ticks without re-rendering; state is only the rendered value.
  const smoothed = useRef(0);
  const peakRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      smoothed.current = 0;
      peakRef.current = 0;
      setLevel(0);
      setPeak(0);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer: number | null = null;

    const start = async (): Promise<void> => {
      try {
        const acquired = await acquireDeviceStream('audio', deviceId);
        if (cancelled) {
          acquired.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = acquired;
        const audioCtx = new AudioContext();
        ctx = audioCtx;
        if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => undefined);

        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        audioCtx.createMediaStreamSource(acquired).connect(analyser);
        // NOT connected to the destination: monitoring the mic through the
        // speakers would feed straight back into the recording.
        const samples = new Float32Array(analyser.fftSize);

        timer = window.setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += sample * sample;
          const next = rmsToUnit(Math.sqrt(sum / samples.length));

          smoothed.current = smoothed.current + (next - smoothed.current) * SMOOTHING;
          peakRef.current = Math.max(next, peakRef.current - PEAK_DECAY);
          setLevel(smoothed.current);
          setPeak(peakRef.current);
        }, SAMPLE_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not open this microphone');
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => undefined);
      smoothed.current = 0;
      peakRef.current = 0;
    };
  }, [deviceId, enabled]);

  return { level, peak, error };
}
