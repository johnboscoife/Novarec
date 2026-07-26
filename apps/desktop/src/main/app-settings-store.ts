import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app, safeStorage } from 'electron';
import { AppSettingsSchema, DEFAULT_APP_SETTINGS, type AppSettings } from '@novarec/shared';

/**
 * App settings (appearance, privacy, storage, meeting credentials) as a Zod-
 * validated JSON file in userData.
 *
 * Secrets (LiveKit API secret, Google client secret) are:
 *  - encrypted AT REST with the OS keystore (DPAPI/Keychain/libsecret) via
 *    safeStorage, so the on-disk file never holds a plaintext credential; and
 *  - never handed to the renderer — the IPC layer redacts them (see
 *    `redactSecrets`) and restores the stored value on save (see
 *    `restoreSecrets`), so a compromised/navigated page can't read them.
 *
 * A missing file falls back to defaults (first run); a CORRUPT file is preserved
 * (renamed .corrupt) before falling back, so a torn write can't silently wipe
 * the user's credentials / storage location.
 */

/** Placeholder shown to the renderer in place of a stored secret. */
export const REDACTED_SECRET = '••••••••';
const ENC_PREFIX = 'enc:v1:';

function settingsFile(): string {
  return join(app.getPath('userData'), 'app-settings.json');
}

function encryptField(value: string | null): string | null {
  if (!value || value.startsWith(ENC_PREFIX)) return value;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(value).toString('base64');
    }
  } catch {
    // fall through — store plaintext rather than lose the credential
  }
  return value;
}

function decryptField(value: string | null): string | null {
  if (!value || !value.startsWith(ENC_PREFIX)) return value;
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'));
  } catch {
    return null; // written on another machine/user, or keystore unavailable
  }
}

/** Replace stored secrets with a placeholder before settings leave for the renderer. */
export function redactSecrets(s: AppSettings): AppSettings {
  return {
    ...s,
    googleClientSecret: s.googleClientSecret ? REDACTED_SECRET : s.googleClientSecret,
    livekitApiSecret: s.livekitApiSecret ? REDACTED_SECRET : s.livekitApiSecret,
  };
}

/**
 * When the renderer saves settings back, it echoes the placeholder for any
 * secret it didn't change — keep the real stored value in that case instead of
 * overwriting the credential with bullets.
 */
export function restoreSecrets(incoming: AppSettings, stored: AppSettings): AppSettings {
  return {
    ...incoming,
    googleClientSecret:
      incoming.googleClientSecret === REDACTED_SECRET
        ? stored.googleClientSecret
        : incoming.googleClientSecret,
    livekitApiSecret:
      incoming.livekitApiSecret === REDACTED_SECRET
        ? stored.livekitApiSecret
        : incoming.livekitApiSecret,
  };
}

export async function loadAppSettings(): Promise<AppSettings> {
  let raw: string;
  try {
    raw = await readFile(settingsFile(), 'utf8');
  } catch {
    return DEFAULT_APP_SETTINGS; // no file yet — first run
  }
  try {
    const parsed = AppSettingsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      // Decrypt secrets for internal use (token minting) — callers get plaintext,
      // the renderer never does (the IPC layer redacts).
      return {
        ...parsed.data,
        googleClientSecret: decryptField(parsed.data.googleClientSecret),
        livekitApiSecret: decryptField(parsed.data.livekitApiSecret),
      };
    }
  } catch {
    // fall through — the file exists but is not valid JSON
  }
  // Don't silently discard a real (but unreadable) settings file: keep a copy.
  await rename(settingsFile(), `${settingsFile()}.corrupt`).catch(() => undefined);
  return DEFAULT_APP_SETTINGS;
}

export async function saveAppSettings(settings: AppSettings): Promise<AppSettings> {
  const validated = AppSettingsSchema.parse(settings);
  const file = settingsFile();
  await mkdir(dirname(file), { recursive: true });
  // Persist with secrets encrypted; keep plaintext only for the returned value
  // (callers in main need it to mint tokens).
  const onDisk: AppSettings = {
    ...validated,
    googleClientSecret: encryptField(validated.googleClientSecret),
    livekitApiSecret: encryptField(validated.livekitApiSecret),
  };
  // Write to a unique temp file then atomically rename, so a crash mid-write
  // never leaves truncated JSON that loads as "corrupt → defaults".
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(onDisk, null, 2), 'utf8');
  await rename(tmp, file);
  return validated;
}
