import { describe, it, expect } from 'vitest';
import {
  clipTimelineEnd,
  mergeRanges,
  removeRanges,
  removeTimelineRange,
  rippleDelete,
  splitClip,
  timelineDuration,
  trimClip,
  type Clip,
} from './timeline.js';

const clip = (over: Partial<Clip>): Clip => ({
  id: 'c',
  trackId: 't',
  sourceInMs: 0,
  sourceOutMs: 10_000,
  timelineStartMs: 0,
  ...over,
});

describe('splitClip', () => {
  it('splits a clip into two adjacent halves', () => {
    const [a, b] = splitClip([clip({})], 'c', 4000);
    expect(a).toMatchObject({ sourceInMs: 0, sourceOutMs: 4000, timelineStartMs: 0 });
    expect(b).toMatchObject({ sourceInMs: 4000, sourceOutMs: 10_000, timelineStartMs: 4000 });
  });

  it('ignores a split point outside the clip', () => {
    expect(splitClip([clip({})], 'c', 20_000)).toHaveLength(1);
  });
});

describe('trimClip', () => {
  it('adjusts source in/out and normalizes order', () => {
    const [t] = trimClip([clip({})], 'c', 6000, 2000);
    expect(t).toMatchObject({ sourceInMs: 2000, sourceOutMs: 6000 });
  });
});

describe('rippleDelete', () => {
  it('removes a clip and shifts later clips left by its duration', () => {
    const clips = [
      clip({ id: 'a', sourceOutMs: 2000, timelineStartMs: 0 }),
      clip({ id: 'b', sourceOutMs: 2000, timelineStartMs: 2000 }),
    ];
    const out = rippleDelete(clips, 'a');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'b', timelineStartMs: 0 });
  });
});

describe('removeTimelineRange', () => {
  it('splits a clip around an internal cut and ripples the tail', () => {
    const out = removeTimelineRange([clip({})], 't', 3000, 5000);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ sourceInMs: 0, sourceOutMs: 3000, timelineStartMs: 0 });
    expect(out[1]).toMatchObject({ sourceInMs: 5000, sourceOutMs: 10_000, timelineStartMs: 3000 });
    expect(timelineDuration(out)).toBe(8000); // 2000ms removed from a 10s clip
  });

  it('shifts a fully-later clip left and drops a fully-covered one', () => {
    const clips = [
      clip({ id: 'keep', sourceOutMs: 1000, timelineStartMs: 0 }),
      clip({ id: 'gone', sourceOutMs: 1000, timelineStartMs: 2000 }),
      clip({ id: 'after', sourceOutMs: 1000, timelineStartMs: 5000 }),
    ];
    // Remove [2000,3000): drops 'gone', shifts 'after' left by 1000.
    const out = removeTimelineRange(clips, 't', 2000, 3000);
    expect(out.map((c) => c.id)).toEqual(['keep', 'after']);
    expect(out.find((c) => c.id === 'after')).toMatchObject({ timelineStartMs: 4000 });
  });

  it('leaves other tracks untouched', () => {
    const clips = [clip({ id: 'x', trackId: 'other', timelineStartMs: 0, sourceOutMs: 5000 })];
    expect(removeTimelineRange(clips, 't', 0, 1000)).toEqual(clips);
  });
});

describe('removeRanges', () => {
  it('applies multiple cuts with correct cumulative shift', () => {
    // 10s clip; remove [1000,2000) and [5000,6000) -> 8s total.
    const out = removeRanges([clip({})], 't', [
      { startMs: 1000, endMs: 2000 },
      { startMs: 5000, endMs: 6000 },
    ]);
    expect(timelineDuration(out)).toBe(8000);
    expect(clipTimelineEnd(out[out.length - 1] ?? clip({}))).toBe(8000);
  });
});

describe('overlapping cuts and repeated edits', () => {
  it('cuts exactly the union of overlapping ranges, nothing more', () => {
    // A filler word [2000,4000) inside a silence [1000,3000) — union is [1000,4000).
    const out = removeRanges([clip({})], 't', [
      { startMs: 1000, endMs: 3000 },
      { startMs: 2000, endMs: 4000 },
    ]);
    expect(timelineDuration(out)).toBe(7000);
    // What survives after the cut is source from 4000 on, not later.
    const after = out.find((c) => c.timelineStartMs === 1000);
    expect(after?.sourceInMs).toBe(4000);
  });

  it('merges touching ranges and ignores empty ones', () => {
    expect(
      mergeRanges([
        { startMs: 5, endMs: 8 },
        { startMs: 0, endMs: 2 },
        { startMs: 2, endMs: 3 },
        { startMs: 4, endMs: 4 },
      ]),
    ).toEqual([
      { startMs: 0, endMs: 3 },
      { startMs: 5, endMs: 8 },
    ]);
  });

  it('never produces two clips with the same id', () => {
    let clips = splitClip([clip({ id: 'x' })], 'x', 6000);
    clips = splitClip(clips, 'x', 3000); // split the original again
    clips = removeTimelineRange(clips, 't', 1000, 2000);
    clips = removeTimelineRange(clips, 't', 500, 700);
    const ids = clips.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
