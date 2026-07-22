import type { CaptureSource } from '@novarec/shared';

/**
 * @novarec/capture — source enumeration, region capture, and the track manager.
 * Phase 1 implements this. Placeholder export keeps the workspace graph and
 * type-check honest until then.
 */
export const CAPTURE_PACKAGE = '@novarec/capture' as const;

export function describeSource(source: CaptureSource): string {
  return `${source.kind}:${source.label}`;
}
