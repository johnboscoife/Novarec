import { BrowserWindow, globalShortcut } from 'electron';
import {
  DEFAULT_HOTKEYS,
  findHotkeyConflicts,
  type HotkeyAction,
  type HotkeyMap,
} from '@novarec/shared';

/**
 * System-wide hotkeys via Electron globalShortcut — they fire even when NovaRec
 * is unfocused, and drive the full recording lifecycle from another app.
 * Conflicting or OS-reserved bindings are skipped (not silently clobbered).
 */
function broadcast(action: HotkeyAction): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('hotkey:action', action);
  }
}

export function registerHotkeys(map: HotkeyMap = DEFAULT_HOTKEYS): {
  registered: HotkeyMap;
  failed: HotkeyMap;
} {
  unregisterHotkeys();
  const conflictingActions = new Set(findHotkeyConflicts(map).flatMap((c) => c.actions));
  const registered: HotkeyMap = [];
  const failed: HotkeyMap = [];

  for (const binding of map) {
    if (conflictingActions.has(binding.action)) {
      failed.push(binding);
      continue;
    }
    try {
      const ok = globalShortcut.register(binding.accelerator, () => broadcast(binding.action));
      (ok ? registered : failed).push(binding);
    } catch {
      failed.push(binding);
    }
  }
  return { registered, failed };
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll();
}
