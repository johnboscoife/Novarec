import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { AppSettingsSchema, DEFAULT_APP_SETTINGS, type AppSettings } from '@novarec/shared';

/**
 * App settings (appearance, privacy, storage) as a Zod-validated JSON file in
 * userData. A corrupt or drifted file falls back to privacy-preserving defaults
 * rather than throwing.
 */
function settingsFile(): string {
  return join(app.getPath('userData'), 'app-settings.json');
}

export async function loadAppSettings(): Promise<AppSettings> {
  try {
    const parsed = AppSettingsSchema.safeParse(JSON.parse(await readFile(settingsFile(), 'utf8')));
    return parsed.success ? parsed.data : DEFAULT_APP_SETTINGS;
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<AppSettings> {
  const validated = AppSettingsSchema.parse(settings);
  const file = settingsFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(validated, null, 2), 'utf8');
  return validated;
}
