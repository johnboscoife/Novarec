/**
 * @novarec/capture — source enumeration, region capture, and (later) the track
 * manager. The pure geometry/sustain/region/source logic here is shared by
 * Record, Meet, and Studio; Electron-native wiring lives in the desktop app.
 */
export const CAPTURE_PACKAGE = '@novarec/capture' as const;

export * from './geometry.js';
export * from './sustain.js';
export * from './sources.js';
export * from './cameras.js';
export * from './bitrate.js';
export * from './sync.js';
