import type { CursorEvent, RedactionZone } from '@novarec/shared';

/**
 * @novarec/overlay — the single input-driven overlay engine behind cursor zoom,
 * click emphasis, annotation, redaction, markers, and teleprompter. Phase 4
 * (the differentiator) implements it as one system, not six features.
 */
export const OVERLAY_PACKAGE = '@novarec/overlay' as const;

export function clickCount(events: readonly CursorEvent[]): number {
  return events.filter((e) => e.event === 'click').length;
}

export function activeRedactions(zones: readonly RedactionZone[], atMs: number): RedactionZone[] {
  return zones.filter((z) => atMs >= z.fromMs && (z.toMs === null || atMs <= z.toMs));
}
