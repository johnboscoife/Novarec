/**
 * Classifying camera inputs by what they actually are.
 *
 * A phone used as a webcam reaches the OS through a companion app's virtual
 * camera driver (Iriun, DroidCam, Camo, EpocCam, iVCam…), so it arrives in
 * `enumerateDevices` looking like any other camera — the only signal is its
 * label. Grouping them explicitly is the difference between "which of these
 * seven entries is my phone?" and picking the obvious one.
 *
 * Pure and unit-tested: label matching is exactly the kind of thing that rots
 * silently when a vendor renames a driver.
 */
export type CameraKind = 'phone' | 'virtual' | 'builtin';

/**
 * Device id for a phone paired over Wi-Fi. It is not a real `enumerateDevices`
 * id — that phone has no driver on this machine — so it gets a namespaced
 * sentinel that can never collide with an OS-issued id, and the camera picker
 * offers it alongside the real devices.
 */
export const PHONE_WIFI_DEVICE_ID = 'novarec:phone-wifi';

/** Is this selection the Wi-Fi phone rather than a device on this machine? */
export function isPhoneWifiDevice(deviceId: string | null): boolean {
  return deviceId === PHONE_WIFI_DEVICE_ID;
}

/**
 * Phone-as-webcam companion apps, by the driver name they register. Matched
 * case-insensitively as substrings, because vendors append their own suffixes
 * ("DroidCam Source 3", "Iriun Webcam", "Camo Camera").
 */
const PHONE_CAMERA_MARKERS: readonly string[] = [
  'iriun',
  'droidcam',
  'epoccam',
  'ivcam',
  'camo', // Reincubate Camo
  'kinoni',
  'iphone', // macOS Continuity Camera surfaces the device name directly
  'ipad',
  'android',
  'phone',
  // Windows 11's built-in "connected camera": pairing a phone through
  // Settings → Mobile devices registers it as "<phone name> (Windows Virtual
  // Camera)". Nothing else creates that name, and it IS a phone — so it must
  // be matched here, ahead of the generic "virtual camera" rule below, which
  // would otherwise file the user's phone under ordinary virtual cameras.
  'windows virtual camera',
];

/**
 * Non-phone virtual cameras. Worth separating so a user hunting for their phone
 * isn't offered OBS's output as if it were one.
 */
const VIRTUAL_CAMERA_MARKERS: readonly string[] = [
  'obs virtual',
  'obs-camera',
  'xsplit',
  'snap camera',
  'nvidia broadcast',
  'manycam',
  'streamlabs',
  'virtual camera',
  'vcam',
];

function matches(label: string, markers: readonly string[]): boolean {
  const l = label.toLowerCase();
  return markers.some((m) => l.includes(m));
}

/** What kind of camera a device label describes. */
export function classifyCamera(label: string): CameraKind {
  // Phone markers win: "Camo Virtual Camera" is a phone, not a generic virtual
  // camera, and it matches both lists.
  if (matches(label, PHONE_CAMERA_MARKERS)) return 'phone';
  if (matches(label, VIRTUAL_CAMERA_MARKERS)) return 'virtual';
  return 'builtin';
}

/** True when the label looks like a phone acting as a webcam. */
export function isPhoneCamera(label: string): boolean {
  return classifyCamera(label) === 'phone';
}

export interface GroupedCameras<T> {
  phone: T[];
  other: T[];
}

/**
 * Split cameras into "phone" and everything else, preserving the original
 * order within each group.
 */
export function groupCamerasByKind<T>(
  cameras: readonly T[],
  labelOf: (c: T) => string,
): GroupedCameras<T> {
  const phone: T[] = [];
  const other: T[] = [];
  for (const camera of cameras) {
    if (isPhoneCamera(labelOf(camera))) phone.push(camera);
    else other.push(camera);
  }
  return { phone, other };
}
