import { useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { deviceSource } from '@novarec/capture';
import {
  CaptureSettingsSchema,
  DisplayInfoSchema,
  SourceListSchema,
  type CaptureSettings,
  type CaptureSource,
  type DisplayInfo,
  type SourceList,
} from '@novarec/shared';

/** Coalesce bursts of `devicechange` from a flapping virtual-camera driver. */
const DEVICE_CHANGE_DEBOUNCE_MS = 400;

// Responses are re-validated in the renderer (defense in depth; main validates too).
const DisplayListSchema = z.array(DisplayInfoSchema);

export function useDisplays() {
  return useQuery<DisplayInfo[]>({
    queryKey: ['capture:getDisplays'],
    queryFn: async () => DisplayListSchema.parse(await window.novarec.getDisplays()),
  });
}

export function useSources() {
  return useQuery<SourceList>({
    queryKey: ['capture:listSources'],
    queryFn: async () => SourceListSchema.parse(await window.novarec.listSources()),
  });
}

export function useCaptureSettings() {
  return useQuery<CaptureSettings>({
    queryKey: ['capture:getSettings'],
    queryFn: async () => CaptureSettingsSchema.parse(await window.novarec.getCaptureSettings()),
  });
}

export function useSaveCaptureSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: CaptureSettings) => window.novarec.saveCaptureSettings(settings),
    onSuccess: (saved) => client.setQueryData(['capture:getSettings'], saved),
  });
}

/**
 * Camera/microphone enumeration (renderer-only). Includes USB / Bluetooth /
 * built-in inputs. Re-enumerates automatically when devices are plugged in or
 * removed (`devicechange`); labels appear once permission is granted (see
 * `usePrimeDevices`).
 */
export function useMediaDevices() {
  const client = useQueryClient();

  useEffect(() => {
    // Debounced: some virtual-camera drivers (phone-webcam helpers in
    // particular) register and unregister repeatedly, firing `devicechange` in
    // bursts. Re-enumerating on every one made the camera list flicker and
    // could yank the selection out from under the user mid-click.
    let timer = 0;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void client.invalidateQueries({ queryKey: ['media-devices'] });
      }, DEVICE_CHANGE_DEBOUNCE_MS);
    };
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      window.clearTimeout(timer);
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [client]);

  return useQuery<CaptureSource[]>({
    queryKey: ['media-devices'],
    queryFn: async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      // De-dupe by id: a driver mid-reinstall can be reported twice, which
      // showed the same camera twice in the picker.
      const seen = new Set<string>();
      return devices
        .filter((d) => d.kind === 'videoinput' || d.kind === 'audioinput')
        .filter((d) => {
          const key = `${d.kind}:${d.deviceId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((d) =>
          deviceSource(
            {
              deviceId: d.deviceId,
              label: d.label,
              kind: d.kind === 'videoinput' ? 'videoinput' : 'audioinput',
            },
            30,
          ),
        );
    },
  });
}

/**
 * Returns a function that requests permission for a device kind (unlocking real
 * device labels) then re-enumerates. Called when the user enables a camera or
 * microphone track — permission they're opting into anyway.
 */
export function usePrimeDevices() {
  const client = useQueryClient();
  return useCallback(
    async (constraints: MediaStreamConstraints) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        // Permission denied or no device — labels stay generic; not fatal.
      }
      await client.invalidateQueries({ queryKey: ['media-devices'] });
    },
    [client],
  );
}
