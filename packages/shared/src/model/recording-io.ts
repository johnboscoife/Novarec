import { z } from 'zod';
import { RecordingStatusSchema } from './recording.js';

/**
 * Session/recovery I/O types shared between the encoder (which produces them)
 * and the IPC contract (which ships them to the renderer). Kept here because
 * the contract lives in @shared and cannot depend on @novarec/encoder.
 */

/** A recording that never received a terminal stop — a crash candidate. */
export const OrphanedRecordingSchema = z.object({
  dir: z.string(),
  recordingId: z.string(),
  createdAt: z.string(),
  status: RecordingStatusSchema,
  sealedSegmentCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
});
export type OrphanedRecording = z.infer<typeof OrphanedRecordingSchema>;

/** The outcome of reconstructing a playable file from an orphaned recording. */
export const RecoveryResultSchema = z.object({
  recordingId: z.string(),
  outputPath: z.string(),
  segmentCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
});
export type RecoveryResult = z.infer<typeof RecoveryResultSchema>;

/** Summary returned when a recording is finalized. */
export const RecordingSummarySchema = z.object({
  recordingId: z.string(),
  dir: z.string(),
  status: RecordingStatusSchema,
  segmentCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
});
export type RecordingSummary = z.infer<typeof RecordingSummarySchema>;
