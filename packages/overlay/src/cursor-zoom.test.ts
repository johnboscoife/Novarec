import { describe, it, expect } from 'vitest';
import type { CursorEvent } from '@novarec/shared';
import { DEFAULT_ZOOM_CONFIG, generateZoomKeyframes, sampleZoomAt } from './cursor-zoom.js';

const FRAME = { width: 1000, height: 500 };
const click = (atMs: number, x: number, y: number): CursorEvent => ({ atMs, x, y, event: 'click' });

describe('cursor-zoom keyframe generation', () => {
  it('returns no keyframes when there is no activity', () => {
    expect(generateZoomKeyframes([], FRAME, DEFAULT_ZOOM_CONFIG)).toEqual([]);
  });

  it('zooms in on a click and back out after the hold', () => {
    const cfg = {
      ...DEFAULT_ZOOM_CONFIG,
      intensity: 2,
      easeMs: 300,
      holdMs: 1000,
      mergeGapMs: 500,
    };
    const kfs = generateZoomKeyframes([click(2000, 500, 250)], FRAME, cfg);

    // A single click -> 4 control points: out→in→hold→out.
    expect(kfs).toHaveLength(4);
    expect(kfs.map((k) => k.atMs)).toEqual([1700, 2000, 3000, 3300]);
    expect(kfs[1]?.scale).toBe(2);
    expect(kfs[1]?.centerXNorm).toBeCloseTo(0.5, 5);
    expect(kfs[1]?.centerYNorm).toBeCloseTo(0.5, 5);
    expect(kfs[0]?.scale).toBe(1);
    expect(kfs[3]?.scale).toBe(1);
  });

  it('merges clicks within the merge gap into one sustained zoom', () => {
    const cfg = { ...DEFAULT_ZOOM_CONFIG, easeMs: 200, holdMs: 800, mergeGapMs: 600 };
    // Three clicks 400ms apart -> one cluster.
    const kfs = generateZoomKeyframes(
      [click(1000, 200, 100), click(1400, 800, 400), click(1800, 500, 250)],
      FRAME,
      cfg,
    );
    expect(kfs).toHaveLength(4);
    // Zoom holds until last click + hold, then eases out.
    expect(kfs[2]?.atMs).toBe(1800 + 800);
    // Center is the centroid of the cluster.
    expect(kfs[1]?.centerXNorm).toBeCloseTo((200 + 800 + 500) / 3 / 1000, 5);
  });

  it('produces separate zooms for clusters beyond the merge gap', () => {
    const cfg = { ...DEFAULT_ZOOM_CONFIG, mergeGapMs: 500 };
    const kfs = generateZoomKeyframes([click(1000, 100, 100), click(5000, 900, 400)], FRAME, cfg);
    expect(kfs).toHaveLength(8); // two clusters × 4 control points
  });

  it('never emits a keyframe at a negative time', () => {
    const cfg = { ...DEFAULT_ZOOM_CONFIG, easeMs: 500 };
    const kfs = generateZoomKeyframes([click(100, 500, 250)], FRAME, cfg);
    expect(kfs.every((k) => k.atMs >= 0)).toBe(true);
  });
});

describe('sampleZoomAt', () => {
  const cfg = { ...DEFAULT_ZOOM_CONFIG, intensity: 2, easeMs: 300, holdMs: 1000, mergeGapMs: 500 };
  const kfs = generateZoomKeyframes([click(2000, 500, 250)], FRAME, cfg);

  it('is fully zoomed out before and after the sequence', () => {
    expect(sampleZoomAt(kfs, 0).scale).toBe(1);
    expect(sampleZoomAt(kfs, 10_000).scale).toBe(1);
  });

  it('is fully zoomed in during the hold', () => {
    expect(sampleZoomAt(kfs, 2500).scale).toBe(2);
  });

  it('interpolates between keyframes mid-transition', () => {
    const mid = sampleZoomAt(kfs, 1850); // halfway through the 1700->2000 ease-in
    expect(mid.scale).toBeGreaterThan(1);
    expect(mid.scale).toBeLessThan(2);
  });
});
