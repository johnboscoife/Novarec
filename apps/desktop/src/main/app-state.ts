/**
 * Small main-process state cache for decisions that must happen synchronously in
 * event handlers (e.g. the window 'close' handler can't await settings/IPC).
 * The renderer keeps these current via IPC; startup seeds them from settings.
 */
let recordingActive = false;
let confirmOnExit = true;

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
