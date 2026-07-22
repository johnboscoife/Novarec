import type { Transcript, TranscriptWord } from '@novarec/shared';
import type { TimeRange } from './timeline.js';

/**
 * Transcript-based editing: deleting words maps to cut ranges on the timeline.
 * Contiguous selected words merge into one range (so the silence between two
 * deleted fillers goes too).
 */
export const DEFAULT_FILLERS = ['um', 'uh', 'er', 'ah', 'hmm', 'like', 'basically', 'literally'];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
}

export function wordRanges(
  words: readonly TranscriptWord[],
  selected: (word: TranscriptWord, index: number) => boolean,
): TimeRange[] {
  const ranges: TimeRange[] = [];
  let open: TimeRange | null = null;
  let prevIndex = -2;

  words.forEach((word, index) => {
    if (!selected(word, index)) return;
    if (open && index === prevIndex + 1) {
      open.endMs = word.endMs; // contiguous — extend through the gap
    } else {
      if (open) ranges.push(open);
      open = { startMs: word.startMs, endMs: word.endMs };
    }
    prevIndex = index;
  });
  if (open) ranges.push(open);
  return ranges;
}

/** Cut ranges for an explicit set of word indices (transcript-panel deletion). */
export function selectedWordRanges(
  transcript: Transcript,
  indices: ReadonlySet<number>,
): TimeRange[] {
  return wordRanges(transcript.words, (_word, index) => indices.has(index));
}

/** Cut ranges for every filler word in the transcript. */
export function fillerWordRanges(
  transcript: Transcript,
  fillers: readonly string[] = DEFAULT_FILLERS,
): TimeRange[] {
  const set = new Set(fillers.map((f) => f.toLowerCase()));
  return wordRanges(transcript.words, (word) => set.has(normalize(word.text)));
}
