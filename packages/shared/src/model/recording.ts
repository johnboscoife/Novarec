import { z } from 'zod';
import { RectSchema } from './primitives.js';
import { TrackSchema } from './track.js';

export const MarkerSchema = z.object({
  id: z.string(),
  atMs: z.number().nonnegative(),
  label: z.string(),
  color: z.string(),
});
export type Marker = z.infer<typeof MarkerSchema>;

export const CursorEventKindSchema = z.enum(['move', 'click', 'drag', 'keypress']);
export type CursorEventKind = z.infer<typeof CursorEventKindSchema>;

/** Recorded as a data track; drives post-hoc cursor zoom and click emphasis. */
export const CursorEventSchema = z.object({
  atMs: z.number().nonnegative(),
  x: z.number(),
  y: z.number(),
  event: CursorEventKindSchema,
});
export type CursorEvent = z.infer<typeof CursorEventSchema>;

export const RedactionModeSchema = z.enum(['blur', 'pixelate', 'solid']);
export type RedactionMode = z.infer<typeof RedactionModeSchema>;

/**
 * A region whose pixels are obscured AT CAPTURE — sensitive pixels are never
 * written to disk (security requirement). `toMs: null` means "until end".
 */
export const RedactionZoneSchema = z.object({
  id: z.string(),
  rect: RectSchema,
  mode: RedactionModeSchema,
  fromMs: z.number().nonnegative(),
  toMs: z.number().nonnegative().nullable(),
  follow: z.enum(['window', 'fixed']).optional(),
});
export type RedactionZone = z.infer<typeof RedactionZoneSchema>;

export const TranscriptWordSchema = z.object({
  text: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  speaker: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;

/** Local Whisper output; word-level timing enables transcript-based editing. */
export const TranscriptSchema = z.object({
  language: z.string(),
  words: z.array(TranscriptWordSchema),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

export const RecordingStatusSchema = z.enum([
  'recording',
  'paused',
  'finalizing',
  'ready',
  'recovered',
]);
export type RecordingStatus = z.infer<typeof RecordingStatusSchema>;

/**
 * The top-level unit of captured work. Tracks stay separate here; flattening
 * happens only at export. A `recovered` status marks a recording rebuilt from
 * orphaned segments after a crash.
 */
export const RecordingSchema = z.object({
  id: z.string(),
  createdAt: z.string(), // ISO-8601 timestamp
  status: RecordingStatusSchema,
  tracks: z.array(TrackSchema),
  markers: z.array(MarkerSchema),
  cursorEvents: z.array(CursorEventSchema),
  redactionZones: z.array(RedactionZoneSchema),
  transcript: TranscriptSchema.optional(),
});
export type Recording = z.infer<typeof RecordingSchema>;
