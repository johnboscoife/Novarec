import type { Marker } from '@novarec/shared';

export interface Chapter {
  title: string;
  startMs: number;
}

/**
 * Turn timeline markers into export chapters: sorted, clamped to the media
 * length, de-duplicated by timestamp, and guaranteed to start at 0.
 */
export function markersToChapters(markers: readonly Marker[], totalDurationMs: number): Chapter[] {
  const sorted = markers
    .filter((m) => m.atMs >= 0 && m.atMs < totalDurationMs)
    .slice()
    .sort((a, b) => a.atMs - b.atMs);

  const chapters: Chapter[] = [];
  let lastAt = -1;
  for (const marker of sorted) {
    if (marker.atMs === lastAt) continue; // one chapter per instant
    chapters.push({
      title: marker.label || `Chapter ${chapters.length + 1}`,
      startMs: marker.atMs,
    });
    lastAt = marker.atMs;
  }

  // Chapters must cover from the start for most players.
  if (chapters.length > 0 && chapters[0] && chapters[0].startMs > 0) {
    chapters.unshift({ title: 'Intro', startMs: 0 });
  }
  return chapters;
}
