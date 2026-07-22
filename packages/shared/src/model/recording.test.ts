import { describe, it, expect } from 'vitest';
import { RecordingSchema } from './recording.js';
import { SegmentSchema, TrackSchema } from './track.js';

describe('core data model schemas', () => {
  it('accepts a well-formed recording with a separate track per source', () => {
    const recording = {
      id: 'rec_1',
      createdAt: '2026-07-22T10:00:00.000Z',
      status: 'ready',
      tracks: [
        {
          id: 'trk_screen',
          recordingId: 'rec_1',
          kind: 'video',
          sourceId: 'src_display_0',
          offsetMs: 0,
          segments: [
            { id: 'seg_0', path: 'a.mp4', startMs: 0, durationMs: 2000, sealed: true },
            { id: 'seg_1', path: 'b.mp4', startMs: 2000, durationMs: 1800, sealed: true },
          ],
        },
      ],
      markers: [],
      cursorEvents: [],
      redactionZones: [],
    };

    const parsed = RecordingSchema.parse(recording);
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0]?.segments).toHaveLength(2);
  });

  it('rejects a segment with a negative duration', () => {
    const bad = { id: 's', path: 'x.mp4', startMs: 0, durationMs: -1, sealed: false };
    expect(SegmentSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a track with an unknown kind', () => {
    const bad = {
      id: 't',
      recordingId: 'r',
      kind: 'hologram',
      sourceId: 's',
      offsetMs: 0,
      segments: [],
    };
    expect(TrackSchema.safeParse(bad).success).toBe(false);
  });

  it('allows an open-ended redaction zone (toMs: null means "until end")', () => {
    const recording = RecordingSchema.parse({
      id: 'rec_2',
      createdAt: '2026-07-22T10:00:00.000Z',
      status: 'recording',
      tracks: [],
      markers: [],
      cursorEvents: [],
      redactionZones: [
        {
          id: 'red_0',
          rect: { x: 0, y: 0, width: 100, height: 40 },
          mode: 'blur',
          fromMs: 0,
          toMs: null,
        },
      ],
    });
    expect(recording.redactionZones[0]?.toMs).toBeNull();
  });
});
