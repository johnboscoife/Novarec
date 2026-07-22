import { describe, it, expect } from 'vitest';
import {
  frameIntervals,
  computeProbeMetrics,
  sustainVerdict,
  maxSustainableFps,
} from './sustain.js';

/** Build a timestamp series of `count` frames at a steady `fps`. */
function steadySeries(fps: number, count: number): number[] {
  const step = 1000 / fps;
  return Array.from({ length: count }, (_, i) => i * step);
}

describe('frameIntervals', () => {
  it('returns gaps between consecutive timestamps', () => {
    expect(frameIntervals([0, 16, 33, 50])).toEqual([16, 17, 17]);
  });

  it('returns an empty array for fewer than two frames', () => {
    expect(frameIntervals([42])).toEqual([]);
  });
});

describe('computeProbeMetrics', () => {
  it('measures a steady 60fps series as ~60fps with no drops', () => {
    const m = computeProbeMetrics(steadySeries(60, 180), 60);
    expect(m.deliveredFps).toBeCloseTo(60, 0);
    expect(m.droppedRatio).toBeCloseTo(0, 2);
    expect(m.jitterMs).toBeCloseTo(0, 3);
  });

  it('reports ~50% drops when only 30fps is delivered against a 60fps target', () => {
    const m = computeProbeMetrics(steadySeries(30, 90), 60);
    expect(m.deliveredFps).toBeCloseTo(30, 0);
    expect(m.droppedRatio).toBeCloseTo(0.5, 1);
  });

  it('is safe for empty and single-frame inputs', () => {
    expect(computeProbeMetrics([], 60).deliveredFps).toBe(0);
    expect(computeProbeMetrics([5], 60).deliveredFps).toBe(0);
  });
});

describe('sustainVerdict', () => {
  it('marks a near-target delivery as sustained', () => {
    const m = computeProbeMetrics(steadySeries(60, 180), 60);
    expect(sustainVerdict(m, 60)).toBe('sustained');
  });

  it('marks ~87% of target as marginal', () => {
    const m = computeProbeMetrics(steadySeries(52, 156), 60);
    expect(sustainVerdict(m, 60)).toBe('marginal');
  });

  it('marks half-rate delivery as dropped', () => {
    const m = computeProbeMetrics(steadySeries(30, 90), 60);
    expect(sustainVerdict(m, 60)).toBe('dropped');
  });
});

describe('maxSustainableFps', () => {
  it('returns the highest candidate the machine can hold', () => {
    // ~45fps delivered: 30 is sustainable (28.5 <= 45), 60 is not (57 > 45).
    expect(maxSustainableFps(steadySeries(45, 135), [24, 30, 60, 120], 60)).toBe(30);
  });

  it('returns the top candidate when the machine keeps up with the probe', () => {
    expect(maxSustainableFps(steadySeries(60, 180), [24, 30, 60], 60)).toBe(60);
  });

  it('returns 0 when it cannot sustain even the lowest candidate', () => {
    expect(maxSustainableFps([0], [24, 30, 60], 60)).toBe(0);
  });
});
