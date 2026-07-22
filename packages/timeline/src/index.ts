import type { Track } from '@novarec/shared';

/**
 * @novarec/timeline — the editing model: ripple ops, speed ramps, volume
 * envelopes, and transcript sync. Phase 6 implements it.
 */
export const TIMELINE_PACKAGE = '@novarec/timeline' as const;

export function trackKinds(tracks: readonly Track[]): string[] {
  return tracks.map((t) => t.kind);
}
