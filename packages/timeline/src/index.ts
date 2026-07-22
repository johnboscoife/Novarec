/**
 * @novarec/timeline — the editing model. Immutable clip operations (split,
 * trim, ripple-delete, remove-range) plus the transcript-based-editing and
 * silence-removal logic that build on them. All pure and unit-tested.
 */
export const TIMELINE_PACKAGE = '@novarec/timeline' as const;

export * from './timeline.js';
export * from './transcript-edit.js';
export * from './silence.js';
