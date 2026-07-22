import { describe, it, expect } from 'vitest';
import { sessionOffsets, syncDriftMs, withinDriftBudget, type TrackTiming } from './sync.js';

const tracks = (...t: TrackTiming[]): TrackTiming[] => t;

describe('multi-track sync', () => {
  it('reports zero drift for perfectly aligned tracks', () => {
    const t = tracks(
      { trackId: 'screen', startOffsetMs: 0, durationMs: 600_000 },
      { trackId: 'mic', startOffsetMs: 0, durationMs: 600_000 },
    );
    expect(syncDriftMs(t)).toBe(0);
    expect(withinDriftBudget(t, 40)).toBe(true);
  });

  it('treats a late start that still ends together as in-sync', () => {
    // mic started 15ms late but captured 15ms less, ending at the same instant.
    const t = tracks(
      { trackId: 'screen', startOffsetMs: 0, durationMs: 10_000 },
      { trackId: 'mic', startOffsetMs: 15, durationMs: 9_985 },
    );
    expect(syncDriftMs(t)).toBe(0);
  });

  it('measures endpoint spread as drift (clock-rate divergence)', () => {
    const t = tracks(
      { trackId: 'video', startOffsetMs: 0, durationMs: 600_000 },
      { trackId: 'audio', startOffsetMs: 0, durationMs: 600_030 }, // +30ms over 10 min
    );
    expect(syncDriftMs(t)).toBe(30);
    expect(withinDriftBudget(t, 40)).toBe(true);
    expect(withinDriftBudget(t, 20)).toBe(false);
  });

  it('normalizes offsets so the earliest track is zero', () => {
    const offsets = sessionOffsets(
      tracks(
        { trackId: 'a', startOffsetMs: 120, durationMs: 1000 },
        { trackId: 'b', startOffsetMs: 100, durationMs: 1000 },
        { trackId: 'c', startOffsetMs: 180, durationMs: 1000 },
      ),
    );
    expect(offsets.get('b')).toBe(0);
    expect(offsets.get('a')).toBe(20);
    expect(offsets.get('c')).toBe(80);
  });

  it('is zero-drift for a single track and empty input', () => {
    expect(syncDriftMs(tracks({ trackId: 'x', startOffsetMs: 0, durationMs: 5 }))).toBe(0);
    expect(syncDriftMs([])).toBe(0);
  });
});
