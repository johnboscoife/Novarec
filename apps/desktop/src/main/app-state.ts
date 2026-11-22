/**
 * Small main-process state cache for decisions that must happen synchronously in
 * event handlers (e.g. the window 'close' handler can't await settings/IPC).
 * The renderer keeps these current via IPC; startup seeds them from settings.
 */
let recordingActive = false;
let confirmOnExit = true;
let storageLocation: string | null = null;
let previousStorageLocations: readonly string[] = [];

export function setRecordingActive(active: boolean): void {
  recordingActive = active;
}
export function isRecordingActive(): boolean {
  return recordingActive;
}

export function setConfirmOnExit(value: boolean): void {
  confirmOnExit = value;
}
export function shouldConfirmExit(): boolean {
  return confirmOnExit;
}

/** Custom recordings folder (null = default app-data vault). */
export function setStorageLocation(location: string | null): void {
  storageLocation = location;
}
export function getStorageLocation(): string | null {
  return storageLocation;
}

/** Storage folders used before the current one (still vaults). */
export function setPreviousStorageLocations(locations: readonly string[]): void {
  previousStorageLocations = [...locations];
}
export function getPreviousStorageLocations(): readonly string[] {
  return previousStorageLocations;
}
