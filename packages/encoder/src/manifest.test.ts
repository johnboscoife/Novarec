import { describe, it, expect } from 'vitest';
import {
  parseEvents,
  reduceEvents,
  sealedSegments,
  serializeEvent,
  totalDurationMs,
  type ManifestEvent,
} from './manifest.js';

const START: ManifestEvent = {
  type: 'start',
  version: 1,
  recordingId: 'r1',
  createdAt: '2026-07-22T10:00:00.000Z',
  trackKind: 'video',
  initSegment: 'init.mp4',
};

describe('manifest event log', () => {
  it('reduces events into recording state', () => {
    const events: ManifestEvent[] = [
      START,
      { type: 'segment-open', index: 0, path: 'seg-000000.mp4', startMs: 0 },
      { type: 'segment-seal', index: 0, durationMs: 2000, bytes: 1000 },
      { type: 'segment-open', index: 1, path: 'seg-000001.mp4', startMs: 2000 },
      { type: 'segment-seal', index: 1, durationMs: 1500, bytes: 800 },
      { type: 'stop', atMs: 3500, status: 'ready' },
    ];
    const state = reduceEvents(events);
    expect(state.recordingId).toBe('r1');
    expect(state.status).toBe('ready');
    expect(state.stopped).toBe(true);
    expect(state.segments).toHaveLength(2);
    expect(totalDurationMs(state)).toBe(3500);
  });

  it('treats an unsealed segment as not durable and the recording as not stopped', () => {
    const state = reduceEvents([
      START,
      { type: 'segment-open', index: 0, path: 'seg-000000.mp4', startMs: 0 },
    ]);
    expect(state.segments[0]?.sealed).toBe(false);
    expect(sealedSegments(state)).toHaveLength(0);
    expect(state.stopped).toBe(false);
  });

  it('round-trips through serialize/parse', () => {
    const events: ManifestEvent[] = [START, { type: 'pause', atMs: 100 }];
    expect(parseEvents(events.map(serializeEvent).join(''))).toEqual(events);
  });

  it('tolerates a torn final manifest line (crash mid-append)', () => {
    const jsonl = serializeEvent(START) + '{"type":"segment-open","index":0,"path":"seg-';
    expect(parseEvents(jsonl)).toEqual([START]);
  });

  it('ignores schema-invalid events', () => {
    const jsonl = serializeEvent(START) + '{"type":"bogus"}\n';
    expect(parseEvents(jsonl)).toEqual([START]);
  });

  it('reflects pause/resume in status', () => {
    expect(reduceEvents([START, { type: 'pause', atMs: 10 }]).status).toBe('paused');
    expect(
      reduceEvents([START, { type: 'pause', atMs: 10 }, { type: 'resume', atMs: 20 }]).status,
    ).toBe('recording');
  });
});
