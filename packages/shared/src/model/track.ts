import { z } from 'zod';

/**
 * A finalized media chunk on disk. Segments are APPEND-ONLY: once written and
 * sealed (fsync'd), a segment is never rewritten, truncated, or replaced. This
 * is the foundation of the "never lose a recording" rule — see Phase 2.
 */
export const SegmentSchema = z.object({
  id: z.string(),
  path: z.string(),
  startMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  sealed: z.boolean(),
});
export type Segment = z.infer<typeof SegmentSchema>;

export const TrackKindSchema = z.enum(['video', 'audio', 'overlay', 'cursor', 'events']);
export type TrackKind = z.infer<typeof TrackKindSchema>;

/**
 * An independent, time-aligned stream within a recording. Screen, camera, mic,
 * system audio, and the annotation overlay are all separate tracks and stay
 * that way until export — every downstream edit depends on it. `offsetMs`
 * aligns the track against the single monotonic session clock.
 */
export const TrackSchema = z.object({
  id: z.string(),
  recordingId: z.string(),
  kind: TrackKindSchema,
  sourceId: z.string(),
  segments: z.array(SegmentSchema),
  offsetMs: z.number(),
});
export type Track = z.infer<typeof TrackSchema>;
