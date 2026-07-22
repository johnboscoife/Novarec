import type { Segment } from '@novarec/shared';

/**
 * @novarec/encoder — WebCodecs + FFmpeg abstraction and the append-only segment
 * writer. Phase 2 implements segment writing and crash recovery; the writer's
 * tests are written before its happy path (never lose a recording).
 */
export const ENCODER_PACKAGE = '@novarec/encoder' as const;

export function totalDurationMs(segments: readonly Segment[]): number {
  return segments.reduce((sum, s) => sum + s.durationMs, 0);
}
