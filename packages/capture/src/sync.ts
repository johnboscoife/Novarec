/**
 * Multi-track A/V sync math. Every track (screen, camera, mic, system audio) is
 * captured independently against one monotonic session clock; these pure
 * functions align them and measure drift so the pipeline can assert the < 40ms
 * budget without an OS or real capture.
 */
export interface TrackTiming {
  trackId: string;
  /** Delay after session start before this track delivered its first data. */
  startOffsetMs: number;
  /** Total captured duration for this track. */
  durationMs: number;
}

function endTime(t: TrackTiming): number {
  return t.startOffsetMs + t.durationMs;
}

/** Per-track offset normalized so the earliest-starting track is 0. */
export function sessionOffsets(tracks: readonly TrackTiming[]): Map<string, number> {
  const earliest = tracks.reduce((min, t) => Math.min(min, t.startOffsetMs), Infinity);
  const base = Number.isFinite(earliest) ? earliest : 0;
  return new Map(tracks.map((t) => [t.trackId, t.startOffsetMs - base]));
}

/**
 * Drift = spread between track endpoints. Aligned tracks that start and stop
 * together score 0; a track whose clock ran fast/slow ends at a different
 * instant and shows up here.
 */
export function syncDriftMs(tracks: readonly TrackTiming[]): number {
  if (tracks.length < 2) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const t of tracks) {
    const end = endTime(t);
    min = Math.min(min, end);
    max = Math.max(max, end);
  }
  return max - min;
}

export function withinDriftBudget(tracks: readonly TrackTiming[], budgetMs: number): boolean {
  return syncDriftMs(tracks) <= budgetMs;
}
