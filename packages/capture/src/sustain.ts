/**
 * Frame-rate sustain analysis. The Record UI probes capture for ~3 seconds and
 * uses these pure functions to answer "what FPS can this machine actually hold?"
 * — surfaced as the live "your machine can sustain X" indicator.
 */

export interface ProbeMetrics {
  deliveredFps: number;
  /** Fraction of expected frames that never arrived, 0..1, vs the target FPS. */
  droppedRatio: number;
  /** Standard deviation of inter-frame intervals, in ms (frame-time stability). */
  jitterMs: number;
  frameCount: number;
  elapsedMs: number;
}

export type SustainVerdict = 'sustained' | 'marginal' | 'dropped';

/** Verdict thresholds (delivered / target), also used by the UI legend. */
const SUSTAINED_RATIO = 0.95;
const MARGINAL_RATIO = 0.85;
const SUSTAINED_MAX_DROPPED = 0.05;

export function frameIntervals(timestamps: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < timestamps.length; i += 1) {
    const prev = timestamps[i - 1];
    const cur = timestamps[i];
    if (prev === undefined || cur === undefined) continue;
    out.push(cur - prev);
  }
  return out;
}

function stddev(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 1);
}

export function computeProbeMetrics(
  timestamps: readonly number[],
  targetFps: number,
): ProbeMetrics {
  const frameCount = timestamps.length;
  const zero: ProbeMetrics = {
    deliveredFps: 0,
    droppedRatio: 0,
    jitterMs: 0,
    frameCount,
    elapsedMs: 0,
  };
  if (frameCount < 2) return zero;

  const first = timestamps[0];
  const last = timestamps[frameCount - 1];
  if (first === undefined || last === undefined) return zero;

  const elapsedMs = last - first;
  if (elapsedMs <= 0) return zero;

  const deliveredIntervals = frameCount - 1;
  const deliveredFps = deliveredIntervals / (elapsedMs / 1000);
  const expectedIntervals = (elapsedMs / 1000) * targetFps;
  const droppedRatio =
    expectedIntervals > 0
      ? clamp01((expectedIntervals - deliveredIntervals) / expectedIntervals)
      : 0;

  return {
    deliveredFps,
    droppedRatio,
    jitterMs: stddev(frameIntervals(timestamps)),
    frameCount,
    elapsedMs,
  };
}

export function sustainVerdict(metrics: ProbeMetrics, targetFps: number): SustainVerdict {
  if (targetFps <= 0) return 'dropped';
  const ratio = metrics.deliveredFps / targetFps;
  if (ratio >= SUSTAINED_RATIO && metrics.droppedRatio <= SUSTAINED_MAX_DROPPED) return 'sustained';
  if (ratio >= MARGINAL_RATIO) return 'marginal';
  return 'dropped';
}

/**
 * Highest candidate FPS the machine can sustain, given a probe run at
 * `probeTargetFps`. Returns 0 if it cannot hold even the lowest candidate.
 */
export function maxSustainableFps(
  timestamps: readonly number[],
  candidates: readonly number[],
  probeTargetFps: number,
): number {
  const { deliveredFps } = computeProbeMetrics(timestamps, probeTargetFps);
  let best = 0;
  for (const c of candidates) {
    if (deliveredFps >= SUSTAINED_RATIO * c && c > best) best = c;
  }
  return best;
}
