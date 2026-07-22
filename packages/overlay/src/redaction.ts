import type { Rect, RedactionZone } from '@novarec/shared';

/**
 * Redaction resolution. Zones are applied AT CAPTURE so sensitive pixels never
 * touch disk (security requirement). These pure helpers decide which zones are
 * active at a given time and where they land (fixed vs window-following).
 */
export function activeRedactions(zones: readonly RedactionZone[], atMs: number): RedactionZone[] {
  return zones.filter((z) => atMs >= z.fromMs && (z.toMs === null || atMs <= z.toMs));
}

/** The rect to obscure: a window-following zone tracks the live window bounds. */
export function resolveRedactionRect(zone: RedactionZone, windowBounds?: Rect): Rect {
  if (zone.follow === 'window' && windowBounds) return windowBounds;
  return zone.rect;
}

let credentialCounter = 0;

/**
 * Build solid redaction zones over detected credential-UI rects (the
 * "auto-blur passwords" preset). Deterministic ids are derived from position so
 * the same detection produces stable zones.
 */
export function credentialRedactions(
  detected: readonly Rect[],
  fromMs: number,
  mode: RedactionZone['mode'] = 'solid',
): RedactionZone[] {
  return detected.map((rect) => {
    credentialCounter += 1;
    return {
      id: `cred-${Math.round(rect.x)}-${Math.round(rect.y)}-${credentialCounter}`,
      rect,
      mode,
      fromMs,
      toMs: null,
      follow: 'fixed',
    };
  });
}
