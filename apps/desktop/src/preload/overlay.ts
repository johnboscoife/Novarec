import { contextBridge, ipcRenderer } from 'electron';
import type { DisplayInfo, Rect } from '@novarec/shared';

/**
 * One overlay window is opened per display, so each one only ever knows about
 * its own display and reports rects in its own local coordinates. Main adds the
 * display origin to get virtual-desktop coordinates.
 */
export interface OverlayInit {
  display: DisplayInfo;
}

/** Minimal surface for the region-selection overlay window only. */
export interface OverlayApi {
  onInit(callback: (data: OverlayInit) => void): void;
  /** Another overlay took over the drag — drop this window's selection. */
  onClear(callback: () => void): void;
  /** A drag started here; main tells the other overlays to clear. */
  begin(): void;
  confirm(displayId: number, rect: Rect): void;
  cancel(): void;
}

const api: OverlayApi = {
  onInit: (callback) => {
    ipcRenderer.on('overlay:init', (_event, data: OverlayInit) => callback(data));
  },
  onClear: (callback) => {
    ipcRenderer.on('overlay:clear', () => callback());
  },
  begin: () => ipcRenderer.send('overlay:begin'),
  confirm: (displayId, rect) => ipcRenderer.send('overlay:confirm', { displayId, rect }),
  cancel: () => ipcRenderer.send('overlay:cancel'),
};

contextBridge.exposeInMainWorld('overlay', api);
