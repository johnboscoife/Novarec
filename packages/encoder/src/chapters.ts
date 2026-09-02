/**
 * Chapter metadata for the exported file.
 *
 * FFmpeg takes chapters as an FFMETADATA input file rather than command-line
 * flags, so this builds that document. Players (and YouTube) read the result as
 * real chapter markers, which is what makes a marker dropped mid-recording
 * useful afterwards instead of just a note.
 *
 * Pure and unit-tested: the format is unforgiving — a stray `=` in a title
 * silently truncates it, and a chapter without an END is dropped entirely.
 */
export interface ChapterInput {
  title: string;
  startMs: number;
}

/**
 * Characters that FFMETADATA treats as syntax. They must be backslash-escaped
 * inside a value or the line is misparsed.
 */
function escapeValue(value: string): string {
  return value.replace(/([=;#\\])/g, '\\$1').replace(/\r?\n/g, ' ');
}

/**
 * Build an FFMETADATA document describing `chapters`.
 *
 * Each chapter runs until the next one starts, and the last runs to the end of
 * the media. Chapters at or beyond the media length are dropped — FFmpeg emits
 * a file with broken seeking if a chapter starts past the end. Returns null
 * when there is nothing worth writing, so callers can skip the extra input
 * entirely.
 */
export function buildChapterMetadata(
  chapters: readonly ChapterInput[],
  totalDurationMs: number,
): string | null {
  if (totalDurationMs <= 0) return null;

  const sorted = chapters
    .filter((c) => c.startMs >= 0 && c.startMs < totalDurationMs)
    .slice()
    .sort((a, b) => a.startMs - b.startMs);
  // Two chapters at the same instant would overlap, which players read as a
  // broken chapter list. Keep the first at each timestamp.
  const usable = sorted.filter((c, i) => i === 0 || c.startMs !== sorted[i - 1]?.startMs);
  if (usable.length === 0) return null;

  const lines = [';FFMETADATA1'];
  usable.forEach((chapter, index) => {
    const next = usable[index + 1];
    const end = next ? next.startMs : totalDurationMs;
    // A zero-length chapter is invalid; give it at least a millisecond.
    const safeEnd = Math.max(end, chapter.startMs + 1);
    lines.push(
      '[CHAPTER]',
      'TIMEBASE=1/1000',
      `START=${String(Math.round(chapter.startMs))}`,
      `END=${String(Math.round(safeEnd))}`,
      `title=${escapeValue(chapter.title)}`,
    );
  });
  return `${lines.join('\n')}\n`;
}
