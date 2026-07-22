import { desktopCapturer, screen } from 'electron';
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

export async function listSources(): Promise<SourceList> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  });

  const screens = sources
    .filter((s) => s.id.startsWith('screen:'))
    .map((s) => ({ id: s.id, name: s.name, displayId: Number(s.display_id) || 0 }));

  const windows = sources
    .filter((s) => s.id.startsWith('window:'))
    .map((s) => ({ id: s.id, name: s.name }));

  return { screens, windows };
}
