import { z } from 'zod';

/**
 * Global hotkey model. Accelerators use Electron's syntax
 * (e.g. "CommandOrControl+Shift+R"). Normalization + conflict detection are pure
 * so they can be unit-tested and reused by the settings UI and the registrar.
 */
export const HotkeyActionSchema = z.enum([
  'startStop',
  'pauseResume',
  'marker',
  'annotateToggle',
  'cursorZoomNow',
  'muteMic',
  'panicStop',
]);
export type HotkeyAction = z.infer<typeof HotkeyActionSchema>;

export const HotkeyBindingSchema = z.object({
  action: HotkeyActionSchema,
  accelerator: z.string(),
});
export type HotkeyBinding = z.infer<typeof HotkeyBindingSchema>;

export const HotkeyMapSchema = z.array(HotkeyBindingSchema);
export type HotkeyMap = z.infer<typeof HotkeyMapSchema>;

export const DEFAULT_HOTKEYS: HotkeyMap = [
  { action: 'startStop', accelerator: 'CommandOrControl+Shift+R' },
  { action: 'pauseResume', accelerator: 'CommandOrControl+Shift+P' },
  { action: 'marker', accelerator: 'CommandOrControl+Shift+M' },
  { action: 'annotateToggle', accelerator: 'CommandOrControl+Shift+A' },
  { action: 'cursorZoomNow', accelerator: 'CommandOrControl+Shift+Z' },
  { action: 'muteMic', accelerator: 'CommandOrControl+Shift+U' },
  { action: 'panicStop', accelerator: 'CommandOrControl+Shift+Escape' },
];

/** Common OS-reserved shortcuts we should refuse to bind over. */
export const OS_RESERVED_ACCELERATORS = ['Alt+F4', 'CommandOrControl+Alt+Delete', 'Super+L'];

const MODIFIER_ALIASES: Record<string, string> = {
  cmdorctrl: 'CommandOrControl',
  commandorcontrol: 'CommandOrControl',
  command: 'Command',
  cmd: 'Command',
  control: 'Control',
  ctrl: 'Control',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
};

/** Canonical form so equivalent accelerators compare equal. */
export function normalizeAccelerator(accelerator: string): string {
  const tokens = accelerator
    .split('+')
    .map((t) => t.trim())
    .filter(Boolean);

  const modifiers: string[] = [];
  const keys: string[] = [];
  for (const token of tokens) {
    const canonical = MODIFIER_ALIASES[token.toLowerCase()];
    if (canonical) modifiers.push(canonical);
    else keys.push(token.length === 1 ? token.toUpperCase() : token);
  }
  const uniqueSortedModifiers = [...new Set(modifiers)].sort();
  return [...uniqueSortedModifiers, ...keys].join('+');
}

const HUMANIZE_MAC: Record<string, string> = {
  CommandOrControl: '⌘',
  Command: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Super: '⌘',
  Escape: 'Esc',
};
const HUMANIZE_OTHER: Record<string, string> = {
  CommandOrControl: 'Ctrl',
  Command: 'Win',
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Super: 'Win',
  Escape: 'Esc',
};

/** Turn an Electron accelerator into a platform-friendly display string. */
export function humanizeAccelerator(
  accelerator: string,
  platform: 'win32' | 'darwin' | 'linux',
): string {
  const map = platform === 'darwin' ? HUMANIZE_MAC : HUMANIZE_OTHER;
  const parts = accelerator.split('+').map((token) => map[token] ?? token);
  return parts.join(platform === 'darwin' ? '' : '+');
}

export interface HotkeyConflict {
  accelerator: string;
  actions: HotkeyAction[];
  reserved: boolean;
}

/** Find bindings that collide with each other or with OS-reserved shortcuts. */
export function findHotkeyConflicts(
  bindings: readonly HotkeyBinding[],
  reserved: readonly string[] = OS_RESERVED_ACCELERATORS,
): HotkeyConflict[] {
  const reservedSet = new Set(reserved.map(normalizeAccelerator));
  const byAccelerator = new Map<string, HotkeyAction[]>();
  for (const binding of bindings) {
    const key = normalizeAccelerator(binding.accelerator);
    const list = byAccelerator.get(key) ?? [];
    list.push(binding.action);
    byAccelerator.set(key, list);
  }

  const conflicts: HotkeyConflict[] = [];
  for (const [accelerator, actions] of byAccelerator) {
    const reservedHit = reservedSet.has(accelerator);
    if (actions.length > 1 || reservedHit) {
      conflicts.push({ accelerator, actions, reserved: reservedHit });
    }
  }
  return conflicts;
}
