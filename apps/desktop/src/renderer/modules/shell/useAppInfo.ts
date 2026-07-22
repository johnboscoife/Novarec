import { useQuery } from '@tanstack/react-query';
import { AppInfoSchema, type AppInfo } from '@novarec/shared';

/**
 * Fetches app info across the preload bridge and validates the response with
 * Zod in the renderer (defense in depth — the main process validates too).
 * Proves the full secure IPC path end to end in Phase 0.
 */
export function useAppInfo() {
  return useQuery<AppInfo>({
    queryKey: ['app:getInfo'],
    queryFn: async () => AppInfoSchema.parse(await window.novarec.getInfo()),
  });
}
