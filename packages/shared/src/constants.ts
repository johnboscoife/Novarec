/**
 * Performance budgets from the spec, expressed as machine-readable constants so
 * they can be asserted by tests and surfaced in the UI. These are acceptance
 * criteria, not aspirations.
 */
export const PERFORMANCE_BUDGETS = {
  coldStartToInteractiveMs: 2500,
  idleCpuPercent: 3,
  recording1080p60CpuPercent: 15,
  droppedFramesFraction: 0.001,
  avSyncDriftMs: 50,
  timelineScrubFrameMs: 16,
  installedSizeMb: 250,
} as const;
export type PerformanceBudgets = typeof PERFORMANCE_BUDGETS;

/** Target duration for a single fragmented-MP4 capture segment (Phase 2). */
export const SEGMENT_TARGET_DURATION_MS = 2000;

/** Selectable capture frame rates surfaced in the UI (Phase 1). */
export const SUPPORTED_TARGET_FPS = [24, 30, 60, 120] as const;
export type SupportedTargetFps = (typeof SUPPORTED_TARGET_FPS)[number];

/** The recording indicator can never be disabled (security requirement). */
export const RECORDING_INDICATOR_ALWAYS_VISIBLE = true;

export const APP_NAME = 'NovaRec';
