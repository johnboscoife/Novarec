import { desktopCapturer, screen, systemPreferences } from 'electron';
import type { DisplayInfo, SourceList } from '@novarec/shared';

/**
 * Display + source enumeration in the main process. `screen` gives DIP bounds
 * and per-display scale factors; `desktopCapturer` gives capturable screens and
 * windows. Camera/mic enumeration happens in the renderer (navigator.mediaDevices).
 */
export function getDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => {
    const info: DisplayInfo = {
      id: d.id,
      bounds: {
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
      },
      scaleFactor: d.scaleFactor,
      primary: d.id === primaryId,
    };
    // exactOptionalPropertyTypes: only set label when present.
    if (d.label) return { ...info, label: d.label };
    return info;
  });
}

/** Shown when macOS has not granted NovaRec Screen Recording permission. */
export const MAC_SCREEN_PERMISSION_MESSAGE =
  'NovaRec needs permission to record your screen. Open System Settings → Privacy & Security → ' +
  'Screen & System Audio Recording, turn on NovaRec, then quit and reopen NovaRec.';

export async function listSources(): Promise<SourceList> {
  let sources: Electron.DesktopCapturerSource[];
  try {
    // Asking also registers NovaRec in macOS's Screen Recording list (and
    // prompts the first time), so always ask before checking the status.
    sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
  } catch (error) {
    // On macOS the only common cause is a missing permission, and Electron's
    // "Failed to get sources." tells the user nothing about how to fix it.
    if (
      process.platform === 'darwin' &&
      systemPreferences.getMediaAccessStatus('screen') !== 'granted'
    ) {
      throw new Error(MAC_SCREEN_PERMISSION_MESSAGE, { cause: error });
    }
    throw error;
  }

  const screens = sources
    .filter((s) => s.id.startsWith('screen:'))
    .map((s) => ({ id: s.id, name: s.name, displayId: Number(s.display_id) || 0 }));

  const windows = sources
    .filter((s) => s.id.startsWith('window:'))
    .map((s) => ({ id: s.id, name: s.name }));

  return { screens, windows };
}
