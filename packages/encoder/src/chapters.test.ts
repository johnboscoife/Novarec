import { describe, it, expect } from 'vitest';
import { buildChapterMetadata } from './chapters.js';

describe('buildChapterMetadata', () => {
  it('writes an FFMETADATA document with one block per chapter', () => {
    const meta = buildChapterMetadata(
      [
        { title: 'Intro', startMs: 0 },
        { title: 'The demo', startMs: 30_000 },
      ],
      60_000,
    );
    expect(meta).toBe(
      [
        ';FFMETADATA1',
        '[CHAPTER]',
        'TIMEBASE=1/1000',
        'START=0',
        'END=30000',
        'title=Intro',
        '[CHAPTER]',
        'TIMEBASE=1/1000',
        'START=30000',
        'END=60000',
        'title=The demo',
        '',
      ].join('\n'),
    );
  });

  it('runs each chapter up to the next, and the last to the end of the media', () => {
    const meta = buildChapterMetadata(
      [
        { title: 'A', startMs: 0 },
        { title: 'B', startMs: 1000 },
        { title: 'C', startMs: 2000 },
      ],
      5000,
    );
    expect(meta).toContain('START=0\nEND=1000');
    expect(meta).toContain('START=1000\nEND=2000');
    expect(meta).toContain('START=2000\nEND=5000');
  });

  it('sorts chapters that arrive out of order', () => {
    const meta = buildChapterMetadata(
      [
        { title: 'Later', startMs: 4000 },
        { title: 'Earlier', startMs: 1000 },
      ],
      8000,
    );
    // "Earlier" must be the first block, or seeking is nonsense.
    expect(meta?.indexOf('title=Earlier')).toBeLessThan(meta?.indexOf('title=Later') ?? -1);
  });

  it('drops chapters at or past the end of the media', () => {
    // FFmpeg produces a file with broken seeking if a chapter starts past the end.
    const meta = buildChapterMetadata(
      [
        { title: 'Real', startMs: 0 },
        { title: 'Past the end', startMs: 9000 },
        { title: 'Exactly the end', startMs: 5000 },
      ],
      5000,
    );
    expect(meta).toContain('title=Real');
    expect(meta).not.toContain('Past the end');
    expect(meta).not.toContain('Exactly the end');
  });

  it('escapes the characters FFMETADATA treats as syntax', () => {
    // An unescaped '=' silently truncates the title at that point.
    const meta = buildChapterMetadata([{ title: 'a=b;c#d\\e', startMs: 0 }], 1000);
    expect(meta).toContain('title=a\\=b\\;c\\#d\\\\e');
  });

  it('flattens newlines in a title rather than breaking the document', () => {
    const meta = buildChapterMetadata([{ title: 'line one\nline two', startMs: 0 }], 1000);
    expect(meta).toContain('title=line one line two');
    // One title line only: a raw newline would start a bogus key.
    expect((meta?.match(/title=/g) ?? []).length).toBe(1);
  });

  it('collapses two chapters at the same instant into one', () => {
    // Overlapping chapters read as a broken list in players.
    const meta = buildChapterMetadata(
      [
        { title: 'A', startMs: 100 },
        { title: 'B', startMs: 100 },
      ],
      1000,
    );
    expect((meta?.match(/\[CHAPTER\]/g) ?? []).length).toBe(1);
    expect(meta).toContain('START=100\nEND=1000\ntitle=A');
    expect(meta).not.toContain('title=B');
  });

  it('never emits a chapter that ends where it starts', () => {
    const meta = buildChapterMetadata([{ title: 'A', startMs: 999 }], 1000);
    // Ends at the media end, which is 1ms later — not a zero-length chapter.
    expect(meta).toContain('START=999\nEND=1000');
  });

  it('returns null when there is nothing worth writing', () => {
    expect(buildChapterMetadata([], 60_000)).toBeNull();
    expect(buildChapterMetadata([{ title: 'A', startMs: 0 }], 0)).toBeNull();
    // Every chapter out of range leaves nothing to say.
    expect(buildChapterMetadata([{ title: 'A', startMs: 5000 }], 1000)).toBeNull();
  });

  it('rounds fractional timestamps — TIMEBASE is whole milliseconds', () => {
    const meta = buildChapterMetadata([{ title: 'A', startMs: 1500.6 }], 4000);
    expect(meta).toContain('START=1501');
    expect(meta).not.toContain('1500.6');
  });
});
