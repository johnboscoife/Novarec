import { z } from 'zod';

/** App-wide settings (appearance, privacy, storage). Persisted like capture settings. */
export const ThemeSchema = z.enum(['system', 'light', 'dark']);
export type Theme = z.infer<typeof ThemeSchema>;

export const AppSettingsSchema = z.object({
  theme: ThemeSchema,
  reducedMotion: z.boolean(),
  telemetryOptIn: z.boolean(), // strictly opt-in; default OFF
  vaultMode: z.boolean(), // encrypt media at rest
  storageLocation: z.string().nullable(),
  storageQuotaGb: z.number().positive().nullable(),
  onboardingComplete: z.boolean(),
  // Immediately produce a shareable MP4 when a recording stops. `.default`
  // keeps older settings files (written before this field existed) valid on
  // load instead of resetting every preference.
  autoExportOnStop: z.boolean().default(true),
  // Google OAuth "Desktop app" client credentials for in-app Meet sign-in. The
  // user pastes these from their own Google Cloud project (a desktop client
  // secret is not confidential). Null until configured.
  googleClientId: z.string().nullable().default(null),
  googleClientSecret: z.string().nullable().default(null),
  // Remember the last Record setup (source, tracks, webcam, fps…) across launches.
  retainSetup: z.boolean().default(true),
  // Folder exported files are written to (null = default <Videos>/NovaRec).
  exportFolder: z.string().nullable().default(null),
  // Delete the raw recording segments automatically once an export succeeds.
  deleteRawAfterExport: z.boolean().default(false),
  // Default export format (an EXPORT_PRESETS id) used for auto-export and as the
  // initial choice in the export picker.
  exportPreset: z.string().default('youtube'),
  // Ask for confirmation when closing NovaRec.
  confirmOnExit: z.boolean().default(true),
  // LiveKit server for NovaRec meetings (URL + API key/secret from LiveKit
  // Cloud or a self-hosted server). Tokens are minted locally in the main
  // process; nothing is sent anywhere until the user joins a room.
  livekitUrl: z.string().nullable().default(null),
  livekitApiKey: z.string().nullable().default(null),
  livekitApiSecret: z.string().nullable().default(null),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  reducedMotion: false,
  telemetryOptIn: false,
  vaultMode: false,
  storageLocation: null,
  storageQuotaGb: null,
  onboardingComplete: false,
  autoExportOnStop: true,
  googleClientId: null,
  googleClientSecret: null,
  retainSetup: true,
  exportFolder: null,
  deleteRawAfterExport: false,
  exportPreset: 'youtube',
  confirmOnExit: true,
  livekitUrl: null,
  livekitApiKey: null,
  livekitApiSecret: null,
};
