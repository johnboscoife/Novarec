import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import {
  CaptureSettingsSchema,
  DEFAULT_CAPTURE_SETTINGS,
  type CaptureSettings,
} from '@novarec/shared';

/**
 * Capture defaults (target FPS, resolution, persisted region) as a small
 * Zod-validated JSON file in userData. Everything works offline; SQLite stays
 * reserved for projects/media. A corrupt or schema-drifted file falls back to
 * defaults rather than throwing — losing a preference must never block launch.
 */
function settingsFile(): string {
  return join(app.getPath('userData'), 'capture-settings.json');
}

export async function loadCaptureSettings(): Promise<CaptureSettings> {
  try {
    const raw = await readFile(settingsFile(), 'utf8');
    const parsed = CaptureSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_CAPTURE_SETTINGS;
  } catch {
    return DEFAULT_CAPTURE_SETTINGS;
  }
}

export async function saveCaptureSettings(settings: CaptureSettings): Promise<CaptureSettings> {
  const validated = CaptureSettingsSchema.parse(settings);
  const file = settingsFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(validated, null, 2), 'utf8');
  return validated;
}
