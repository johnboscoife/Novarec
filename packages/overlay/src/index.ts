/**
 * @novarec/overlay — one input-driven overlay engine, not four features.
 * Cursor events drive zoom-and-pan keyframes; annotations, redactions, and
 * markers are overlay/data tracks resolved by time. All pure so the behavior is
 * unit-tested; the compositor (Phase 9) renders the results.
 */
export const OVERLAY_PACKAGE = '@novarec/overlay' as const;

export * from './cursor-zoom.js';
export * from './redaction.js';
export * from './markers.js';
export * from './annotation.js';
export * from './cursor-live.js';
