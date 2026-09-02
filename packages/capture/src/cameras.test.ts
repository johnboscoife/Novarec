import { describe, it, expect } from 'vitest';
import {
  PHONE_WIFI_DEVICE_ID,
  classifyCamera,
  groupCamerasByKind,
  isPhoneCamera,
  isPhoneWifiDevice,
} from './cameras.js';

describe('classifyCamera', () => {
  it('recognises the phone-as-webcam companion apps by their driver names', () => {
    // The exact strings these register on Windows/macOS.
    expect(classifyCamera('Iriun Webcam')).toBe('phone');
    expect(classifyCamera('DroidCam Source 3')).toBe('phone');
    expect(classifyCamera('EpocCam Camera')).toBe('phone');
    expect(classifyCamera('e2eSoft iVCam')).toBe('phone');
    expect(classifyCamera("Dell's iPhone Camera")).toBe('phone');
  });

  it('matches case-insensitively and ignores vendor suffixes', () => {
    expect(classifyCamera('IRIUN WEBCAM (2)')).toBe('phone');
    expect(classifyCamera('droidcam source 2 #3')).toBe('phone');
  });

  it('classifies non-phone virtual cameras separately', () => {
    expect(classifyCamera('OBS Virtual Camera')).toBe('virtual');
    expect(classifyCamera('NVIDIA Broadcast')).toBe('virtual');
    expect(classifyCamera('ManyCam Virtual Webcam')).toBe('virtual');
  });

  it('treats a real webcam as built-in', () => {
    expect(classifyCamera('Integrated Camera')).toBe('builtin');
    expect(classifyCamera('Logitech BRIO')).toBe('builtin');
    expect(classifyCamera('HD Pro Webcam C920')).toBe('builtin');
  });

  it('prefers "phone" when a label matches both lists', () => {
    // Camo registers as a virtual camera but IS a phone.
    expect(classifyCamera('Reincubate Camo Virtual Camera')).toBe('phone');
  });

  // Windows 11 "connected camera" — a phone paired via Settings → Mobile
  // devices. Reported by a real user, whose phone was filed under generic
  // virtual cameras because the label ends in "Virtual Camera".
  it('recognises the Windows 11 connected camera as a phone, not a virtual camera', () => {
    expect(classifyCamera('Ife Jay (Windows Virtual Camera)')).toBe('phone');
    expect(classifyCamera("Sam's Pixel (Windows Virtual Camera)")).toBe('phone');
  });

  it('still files genuinely non-phone virtual cameras separately', () => {
    // The rule above must not swallow every camera with "virtual" in the name.
    expect(classifyCamera('OBS Virtual Camera')).toBe('virtual');
    expect(classifyCamera('XSplit VCam')).toBe('virtual');
  });

  it('does not mistake an ordinary label for a phone', () => {
    expect(isPhoneCamera('Surface Camera Front')).toBe(false);
    expect(isPhoneCamera('')).toBe(false);
  });
});

describe('groupCamerasByKind', () => {
  const label = (c: { label: string }): string => c.label;

  it('splits phones from everything else, preserving order', () => {
    const cameras = [
      { label: 'Integrated Camera' },
      { label: 'Iriun Webcam' },
      { label: 'OBS Virtual Camera' },
      { label: 'DroidCam Source 3' },
    ];
    const grouped = groupCamerasByKind(cameras, label);
    expect(grouped.phone.map(label)).toEqual(['Iriun Webcam', 'DroidCam Source 3']);
    expect(grouped.other.map(label)).toEqual(['Integrated Camera', 'OBS Virtual Camera']);
  });

  it('returns empty groups for an empty list', () => {
    expect(groupCamerasByKind([], label)).toEqual({ phone: [], other: [] });
  });

  it('puts everything in `other` when no phone is connected', () => {
    const grouped = groupCamerasByKind([{ label: 'Logitech BRIO' }], label);
    expect(grouped.phone).toEqual([]);
    expect(grouped.other).toHaveLength(1);
  });
});

describe('isPhoneWifiDevice', () => {
  it('recognises the Wi-Fi phone sentinel', () => {
    expect(isPhoneWifiDevice(PHONE_WIFI_DEVICE_ID)).toBe(true);
  });

  it('is namespaced so it can never collide with a real OS device id', () => {
    // Real ids are long opaque hashes; ours is explicitly namespaced.
    expect(PHONE_WIFI_DEVICE_ID.startsWith('novarec:')).toBe(true);
    expect(isPhoneWifiDevice('c1f4a8e0b2...')).toBe(false);
    expect(isPhoneWifiDevice('')).toBe(false);
    expect(isPhoneWifiDevice(null)).toBe(false);
  });
});
