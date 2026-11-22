import { z } from 'zod';
import { RecordingStatusSchema, type RecordingStatus } from '@novarec/shared';

/**
 * The recording manifest is an APPEND-ONLY event log (JSON Lines). We never
 * rewrite or truncate it — each state change appends one fsync'd line. This is
 * the backbone of "never lose a recording": a crash leaves a manifest that
 * replays cleanly up to the last durable event, and a torn final line is
 * tolerated by the parser.
 */
export const MANIFEST_FILENAME = 'manifest.jsonl';
export const MANIFEST_VERSION = 1;

export const ManifestEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    version: z.literal(MANIFEST_VERSION),
    recordingId: z.string(),
    createdAt: z.string(),
    trackKind: z.enum(['video', 'audio']),
    initSegment: z.string().nullable(),
  }),
  z.object({
    type: z.literal('segment-open'),
    index: z.number().int().nonnegative(),
    path: z.string(),
    startMs: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal('segment-seal'),
    index: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
    bytes: z.number().nonnegative(),
  }),
  z.object({ type: z.literal('pause'), atMs: z.number().nonnegative() }),
  z.object({ type: z.literal('resume'), atMs: z.number().nonnegative() }),
  z.object({
    type: z.literal('stop'),
    atMs: z.number().nonnegative(),
    status: RecordingStatusSchema,
  }),
]);
export type ManifestEvent = z.infer<typeof ManifestEventSchema>;

export interface SegmentState {
  index: number;
  path: string;
  startMs: number;
  durationMs: number;
  bytes: number;
  sealed: boolean;
}

export interface ManifestState {
  recordingId: string;
  createdAt: string;
  trackKind: 'video' | 'audio';
  initSegment: string | null;
  status: RecordingStatus;
  segments: SegmentState[];
  stopped: boolean;
}

export function serializeEvent(event: ManifestEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Parse a JSONL manifest. A final torn line (crash mid-append) is skipped
 * rather than throwing — the durable prefix is always recoverable.
 */
export function parseEvents(jsonl: string): ManifestEvent[] {
  const events: ManifestEvent[] = [];
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const json = parseLine(trimmed);
    if (json === undefined) continue; // torn/partial line — ignore
    const parsed = ManifestEventSchema.safeParse(json);
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}

/**
 * Parse one manifest line. Older builds could append an event directly onto a
 * torn line (no newline between them), so when the whole line is not JSON, the
 * complete event at its end — every event serializes as `{"type":…` — is
 * still recovered rather than lost with the torn prefix.
 */
function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    const start = line.lastIndexOf('{"type":');
    if (start <= 0) return undefined;
    try {
      return JSON.parse(line.slice(start));
    } catch {
      return undefined;
    }
  }
}

export function reduceEvents(events: readonly ManifestEvent[]): ManifestState {
  const state: ManifestState = {
    recordingId: '',
    createdAt: '',
    trackKind: 'video',
    initSegment: null,
    status: 'recording',
    segments: [],
    stopped: false,
  };
  // Index segments by their index so sealing is O(1) — a long session has tens
  // of thousands of segments and a linear find-per-seal is O(n²) (seconds of
  // stall at stop/recovery).
  const byIndex = new Map<number, SegmentState>();

  for (const event of events) {
    switch (event.type) {
      case 'start':
        state.recordingId = event.recordingId;
        state.createdAt = event.createdAt;
        state.trackKind = event.trackKind;
        state.initSegment = event.initSegment;
        state.status = 'recording';
        break;
      case 'segment-open': {
        const seg: SegmentState = {
          index: event.index,
          path: event.path,
          startMs: event.startMs,
          durationMs: 0,
          bytes: 0,
          sealed: false,
        };
        state.segments.push(seg);
        byIndex.set(event.index, seg);
        break;
      }
      case 'segment-seal': {
        const seg = byIndex.get(event.index);
        if (seg) {
          seg.durationMs = event.durationMs;
          seg.bytes = event.bytes;
          seg.sealed = true;
        }
        break;
      }
      case 'pause':
        state.status = 'paused';
        break;
      case 'resume':
        state.status = 'recording';
        break;
      case 'stop':
        state.status = event.status;
        state.stopped = true;
        break;
    }
  }

  return state;
}

/** Only sealed segments are durable and safe to include in a playable file. */
export function sealedSegments(state: ManifestState): SegmentState[] {
  return state.segments.filter((s) => s.sealed);
}

export function totalDurationMs(state: ManifestState): number {
  return sealedSegments(state).reduce((sum, s) => sum + s.durationMs, 0);
}
