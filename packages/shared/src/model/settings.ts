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
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  reducedMotion: false,
  telemetryOptIn: false,
  vaultMode: false,
  storageLocation: null,
  storageQuotaGb: null,
};
