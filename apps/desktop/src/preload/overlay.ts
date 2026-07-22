import { contextBridge, ipcRenderer } from 'electron';
import type { DisplayInfo, Rect } from '@novarec/shared';

export interface OverlayInit {
  displays: DisplayInfo[];
  virtualBounds: Rect;
}

/** Minimal surface for the region-selection overlay window only. */
export interface OverlayApi {
  onInit(callback: (data: OverlayInit) => void): void;
  confirm(rect: Rect): void;
  cancel(): void;
}

const api: OverlayApi = {
  onInit: (callback) => {
    ipcRenderer.on('overlay:init', (_event, data: OverlayInit) => callback(data));
  },
  confirm: (rect) => ipcRenderer.send('overlay:confirm', rect),
  cancel: () => ipcRenderer.send('overlay:cancel'),
};

contextBridge.exposeInMainWorld('overlay', api);
