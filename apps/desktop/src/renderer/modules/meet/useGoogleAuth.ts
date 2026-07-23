import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GoogleProfile } from '@novarec/shared';

/** The signed-in Google account (null when signed out). */
export function useGoogleProfile() {
  return useQuery<GoogleProfile | null>({
    queryKey: ['google:profile'],
    queryFn: () => window.novarec.googleGetProfile(),
  });
}

export function useGoogleSignIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => window.novarec.googleSignIn(),
    onSuccess: (profile) => client.setQueryData(['google:profile'], profile),
  });
}

export function useGoogleSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => window.novarec.googleSignOut(),
    onSuccess: () => client.setQueryData(['google:profile'], null),
  });
}
