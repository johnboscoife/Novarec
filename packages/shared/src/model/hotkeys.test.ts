import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HOTKEYS,
  findHotkeyConflicts,
  humanizeAccelerator,
  normalizeAccelerator,
  type HotkeyBinding,
} from './hotkeys.js';
import { countdownSequence } from './countdown.js';

describe('accelerator normalization', () => {
  it('canonicalizes aliases and modifier order', () => {
    expect(normalizeAccelerator('ctrl+shift+r')).toBe(normalizeAccelerator('Shift+Control+R'));
    expect(normalizeAccelerator('cmd+r')).toBe(normalizeAccelerator('Command+R'));
    expect(normalizeAccelerator('Option+A')).toBe(normalizeAccelerator('Alt+A'));
  });

  it('uppercases single-character keys', () => {
    expect(normalizeAccelerator('ctrl+r')).toContain('R');
  });
});

describe('hotkey conflicts', () => {
  it('reports the default map as conflict-free', () => {
    expect(findHotkeyConflicts(DEFAULT_HOTKEYS)).toEqual([]);
  });

  it('detects two actions bound to the same accelerator', () => {
    const bindings: HotkeyBinding[] = [
      { action: 'marker', accelerator: 'Control+Shift+M' },
      { action: 'muteMic', accelerator: 'Shift+Ctrl+M' }, // same, different spelling
    ];
    const conflicts = findHotkeyConflicts(bindings);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.actions.sort()).toEqual(['marker', 'muteMic']);
  });

  it('flags a binding over an OS-reserved shortcut', () => {
    const conflicts = findHotkeyConflicts(
      [{ action: 'panicStop', accelerator: 'Alt+F4' }],
      ['Alt+F4'],
    );
    expect(conflicts[0]?.reserved).toBe(true);
  });
});

describe('humanizeAccelerator', () => {
  it('shows Ctrl-style labels on Windows/Linux', () => {
    expect(humanizeAccelerator('CommandOrControl+Shift+R', 'win32')).toBe('Ctrl+Shift+R');
    expect(humanizeAccelerator('CommandOrControl+Shift+Escape', 'win32')).toBe('Ctrl+Shift+Esc');
  });
  it('shows glyphs on macOS', () => {
    expect(humanizeAccelerator('CommandOrControl+Shift+R', 'darwin')).toBe('⌘⇧R');
  });
});

describe('countdown', () => {
  it('counts down to 1', () => {
    expect(countdownSequence(3)).toEqual([3, 2, 1]);
  });
  it('is empty for zero or negative', () => {
    expect(countdownSequence(0)).toEqual([]);
    expect(countdownSequence(-2)).toEqual([]);
  });
});
