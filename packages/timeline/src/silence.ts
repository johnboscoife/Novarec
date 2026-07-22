import type { TimeRange } from './timeline.js';

/**
 * Silence detection over an audio-level series (0..1). A run below `threshold`
 * lasting at least `minDurationMs` becomes a cut range for silence removal.
 * Pure so thresholds can be previewed before applying.
 */
export interface LevelSample {
  atMs: number;
  level: number;
}

export function detectSilences(
  samples: readonly LevelSample[],
  threshold: number,
  minDurationMs: number,
): TimeRange[] {
  const ranges: TimeRange[] = [];
  let runStart: number | null = null;
  let runEnd = 0;

  const flush = (): void => {
    if (runStart !== null && runEnd - runStart >= minDurationMs) {
      ranges.push({ startMs: runStart, endMs: runEnd });
    }
    runStart = null;
  };

  for (const sample of samples) {
    if (sample.level < threshold) {
      if (runStart === null) runStart = sample.atMs;
      runEnd = sample.atMs;
    } else {
      flush();
    }
  }
  flush();
  return ranges;
}
