import type { CaptureSource } from '@novarec/shared';

/**
 * Normalizers turning raw OS/browser enumeration results into the shared
 * `CaptureSource` vocabulary. Kept pure so Record, Meet, and Studio all speak
 * the same source model regardless of where the enumeration came from.
 */

/** A `desktopCapturer` screen entry (from the main process). */
export interface RawDisplaySource {
  id: string; // desktopCapturer source id, e.g. "screen:0:0"
  name: string;
  displayId: number;
}

/** A `desktopCapturer` window entry. */
export interface RawWindowSource {
  id: string; // e.g. "window:12345:0"
  name: string;
}

/** A `navigator.mediaDevices` entry (from the renderer). */
export interface RawMediaDevice {
  deviceId: string;
  label: string;
  kind: 'videoinput' | 'audioinput';
}

export function displaySource(raw: RawDisplaySource, targetFps: number): CaptureSource {
  return {
    id: raw.id,
    kind: 'display',
    label: raw.name || `Display ${raw.displayId}`,
    targetFps,
  };
}

export function windowSource(raw: RawWindowSource, targetFps: number): CaptureSource {
  return {
    id: raw.id,
    kind: 'window',
    label: raw.name || 'Window',
    targetFps,
  };
}

export function deviceSource(raw: RawMediaDevice, targetFps: number): CaptureSource {
  const isCamera = raw.kind === 'videoinput';
  return {
    id: raw.deviceId,
    kind: isCamera ? 'camera' : 'microphone',
    label: raw.label || (isCamera ? 'Camera' : 'Microphone'),
    deviceId: raw.deviceId,
    targetFps,
  };
}
