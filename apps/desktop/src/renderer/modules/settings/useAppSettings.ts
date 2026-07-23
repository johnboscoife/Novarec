import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppSettingsSchema, type AppSettings } from '@novarec/shared';

export function useAppSettings() {
  return useQuery<AppSettings>({
    queryKey: ['settings:get'],
    queryFn: async () => AppSettingsSchema.parse(await window.novarec.getAppSettings()),
  });
}

export function useSaveAppSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: AppSettings) => window.novarec.saveAppSettings(settings),
    onSuccess: (saved) => client.setQueryData(['settings:get'], saved),
  });
}
