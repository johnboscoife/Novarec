/**
 * Telemetry gate. Enforces the non-negotiable rule that NO telemetry leaves the
 * device unless the user has explicitly opted in, and that what does leave is
 * anonymous — any PII-shaped property is dropped. This is the single choke point;
 * all telemetry must pass through `prepareTelemetry`.
 */
export type TelemetryValue = string | number | boolean;

export interface TelemetryEvent {
  name: string;
  props?: Record<string, TelemetryValue>;
}

export interface AnonymousTelemetryEvent {
  name: string;
  props: Record<string, TelemetryValue>;
  sessionId: string;
}

/** Property keys that must never be transmitted. */
const PII_KEYS = new Set([
  'email',
  'name',
  'username',
  'user',
  'identity',
  'path',
  'filename',
  'filepath',
  'ip',
  'address',
  'location',
]);

/**
 * Returns null (send nothing) unless opted in; otherwise an anonymized event
 * with PII-shaped properties stripped and an opaque session id attached.
 */
export function prepareTelemetry(
  optIn: boolean,
  event: TelemetryEvent,
  sessionId: string,
): AnonymousTelemetryEvent | null {
  if (!optIn) return null;
  const props: Record<string, TelemetryValue> = {};
  for (const [key, value] of Object.entries(event.props ?? {})) {
    if (PII_KEYS.has(key.toLowerCase())) continue;
    props[key] = value;
  }
  return { name: event.name, props, sessionId };
}
