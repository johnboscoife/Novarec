import type { CursorEvent } from '@novarec/shared';

/**
 * The cursor-zoom brain: turn a recorded cursor-event track into smooth
 * zoom-and-pan keyframes after the fact (or live). Every keyframe is a plain
 * control point, so the editor can move or delete any of them. Pure — no
 * canvas, no capture — so the behavior is fully unit-tested.
 */
export interface ZoomConfig {
  /** Target scale at full zoom (e.g. 2 = 200%). */
  intensity: number;
  /** Ease-in / ease-out duration in ms. */
  easeMs: number;
  /** How long to stay zoomed after the last activity in a cluster. */
  holdMs: number;
  /** Clicks within this gap share one sustained zoom. */
  mergeGapMs: number;
}

export const DEFAULT_ZOOM_CONFIG: ZoomConfig = {
  intensity: 2,
  easeMs: 350,
  holdMs: 900,
  mergeGapMs: 600,
};

export interface ZoomKeyframe {
  atMs: number;
  scale: number;
  centerXNorm: number; // 0..1 of frame width
  centerYNorm: number; // 0..1 of frame height
  easing: 'linear' | 'easeInOut';
}

export interface ZoomSample {
  scale: number;
  centerXNorm: number;
  centerYNorm: number;
}

interface Frame {
  width: number;
  height: number;
}

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 1);
}

/** Group activity (clicks/drags) into clusters separated by more than the gap. */
function clusterActivity(events: readonly CursorEvent[], mergeGapMs: number): CursorEvent[][] {
  const activity = events
    .filter((e) => e.event === 'click' || e.event === 'drag')
    .slice()
    .sort((a, b) => a.atMs - b.atMs);

  const clusters: CursorEvent[][] = [];
  let current: CursorEvent[] = [];
  for (const event of activity) {
    const last = current[current.length - 1];
    if (last && event.atMs - last.atMs > mergeGapMs) {
      clusters.push(current);
      current = [];
    }
    current.push(event);
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

export function generateZoomKeyframes(
  events: readonly CursorEvent[],
  frame: Frame,
  config: ZoomConfig,
): ZoomKeyframe[] {
  const keyframes: ZoomKeyframe[] = [];

  for (const cluster of clusterActivity(events, config.mergeGapMs)) {
    const first = cluster[0];
    const last = cluster[cluster.length - 1];
    if (!first || !last) continue;

    const centerXNorm = clamp01(
      cluster.reduce((sum, e) => sum + e.x, 0) / cluster.length / frame.width,
    );
    const centerYNorm = clamp01(
      cluster.reduce((sum, e) => sum + e.y, 0) / cluster.length / frame.height,
    );
    const center = { centerXNorm, centerYNorm, easing: 'easeInOut' as const };

    keyframes.push({ atMs: Math.max(0, first.atMs - config.easeMs), scale: 1, ...center });
    keyframes.push({ atMs: first.atMs, scale: config.intensity, ...center });
    keyframes.push({ atMs: last.atMs + config.holdMs, scale: config.intensity, ...center });
    keyframes.push({ atMs: last.atMs + config.holdMs + config.easeMs, scale: 1, ...center });
  }

  return keyframes.sort((a, b) => a.atMs - b.atMs);
}

function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** Interpolated zoom state at a given time (for live preview or export). */
export function sampleZoomAt(keyframes: readonly ZoomKeyframe[], atMs: number): ZoomSample {
  const neutral: ZoomSample = { scale: 1, centerXNorm: 0.5, centerYNorm: 0.5 };
  if (keyframes.length === 0) return neutral;

  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (!first || !last) return neutral;
  if (atMs <= first.atMs)
    return { scale: first.scale, centerXNorm: first.centerXNorm, centerYNorm: first.centerYNorm };
  if (atMs >= last.atMs)
    return { scale: last.scale, centerXNorm: last.centerXNorm, centerYNorm: last.centerYNorm };

  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (!a || !b) continue;
    if (atMs >= a.atMs && atMs <= b.atMs) {
      const span = b.atMs - a.atMs;
      const raw = span > 0 ? (atMs - a.atMs) / span : 1;
      const t = b.easing === 'easeInOut' ? smoothstep(raw) : raw;
      return {
        scale: a.scale + (b.scale - a.scale) * t,
        centerXNorm: a.centerXNorm + (b.centerXNorm - a.centerXNorm) * t,
        centerYNorm: a.centerYNorm + (b.centerYNorm - a.centerYNorm) * t,
      };
    }
  }
  return neutral;
}
