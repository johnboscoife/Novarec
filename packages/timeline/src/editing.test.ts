import { describe, it, expect } from 'vitest';
import type { Transcript } from '@novarec/shared';
import { fillerWordRanges, selectedWordRanges } from './transcript-edit.js';
import { detectSilences } from './silence.js';

const transcript: Transcript = {
  language: 'en',
  words: [
    { text: 'Hello', startMs: 0, endMs: 500 },
    { text: 'um', startMs: 500, endMs: 800 },
    { text: 'world', startMs: 800, endMs: 1200 },
    { text: 'uh', startMs: 1200, endMs: 1400 },
    { text: 'like', startMs: 1400, endMs: 1600 },
  ],
};

describe('transcript editing', () => {
  it('finds filler-word ranges, merging contiguous fillers', () => {
    expect(fillerWordRanges(transcript)).toEqual([
      { startMs: 500, endMs: 800 }, // "um"
      { startMs: 1200, endMs: 1600 }, // "uh like" merged
    ]);
  });

  it('maps a set of deleted word indices to cut ranges', () => {
    // Delete "Hello um" (0,1) -> one merged range; and "world" (2) separately.
    expect(selectedWordRanges(transcript, new Set([0, 1, 3]))).toEqual([
      { startMs: 0, endMs: 800 },
      { startMs: 1200, endMs: 1400 },
    ]);
  });
});

describe('silence detection', () => {
  const samples = [
    { atMs: 0, level: 0.5 },
    { atMs: 100, level: 0.01 },
    { atMs: 200, level: 0.01 },
    { atMs: 300, level: 0.01 },
    { atMs: 400, level: 0.6 },
    { atMs: 500, level: 0.02 }, // too short to count
    { atMs: 600, level: 0.7 },
  ];

  it('detects runs below the threshold that meet the minimum duration', () => {
    expect(detectSilences(samples, 0.05, 150)).toEqual([{ startMs: 100, endMs: 300 }]);
  });

  it('finds nothing when the threshold is below every sample', () => {
    expect(detectSilences(samples, 0, 100)).toEqual([]);
  });
});
