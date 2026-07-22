import { describe, it, expect } from 'vitest';
import { prepareTelemetry } from './telemetry.js';
import { AppSettingsSchema, DEFAULT_APP_SETTINGS } from './settings.js';

describe('telemetry gate', () => {
  it('sends NOTHING when the user has not opted in (default)', () => {
    expect(DEFAULT_APP_SETTINGS.telemetryOptIn).toBe(false);
    expect(prepareTelemetry(false, { name: 'export_completed' }, 'sess-1')).toBeNull();
  });

  it('anonymizes and strips PII when opted in', () => {
    const out = prepareTelemetry(
      true,
      {
        name: 'recording_started',
        props: { fps: 60, tracks: 3, email: 'a@b.com', path: 'C:/secret/vid.mp4' },
      },
      'sess-1',
    );
    expect(out).toEqual({
      name: 'recording_started',
      props: { fps: 60, tracks: 3 }, // email + path dropped
      sessionId: 'sess-1',
    });
  });
});

describe('app settings', () => {
  it('accepts the privacy-preserving defaults', () => {
    const parsed = AppSettingsSchema.parse(DEFAULT_APP_SETTINGS);
    expect(parsed.telemetryOptIn).toBe(false);
    expect(parsed.vaultMode).toBe(false);
  });
});
