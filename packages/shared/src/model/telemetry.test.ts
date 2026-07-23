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

  it('defaults auto-export on', () => {
    expect(DEFAULT_APP_SETTINGS.autoExportOnStop).toBe(true);
  });

  it('fills auto-export for older settings files without resetting other prefs', () => {
    // Simulate a settings file written before autoExportOnStop existed.
    const older: Record<string, unknown> = { ...DEFAULT_APP_SETTINGS, theme: 'dark' };
    delete older.autoExportOnStop;
    const parsed = AppSettingsSchema.parse(older);
    expect(parsed.autoExportOnStop).toBe(true); // filled by default
    expect(parsed.theme).toBe('dark'); // existing preference preserved
  });
});
