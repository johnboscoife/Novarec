import { contextBridge, ipcRenderer } from 'electron';
import type { NovaRecApi } from './api.js';

const api: NovaRecApi = {
  getInfo: () => ipcRenderer.invoke('app:getInfo'),
  ping: (payload) => ipcRenderer.invoke('app:ping', payload),

  getDisplays: () => ipcRenderer.invoke('capture:getDisplays'),
  listSources: () => ipcRenderer.invoke('capture:listSources'),
  getCaptureSettings: () => ipcRenderer.invoke('capture:getSettings'),
  saveCaptureSettings: (settings) => ipcRenderer.invoke('capture:saveSettings', settings),
  beginRegionSelect: () => ipcRenderer.invoke('capture:beginRegionSelect'),
};

// contextIsolation is on, so this is the only channel the renderer can reach.
contextBridge.exposeInMainWorld('novarec', api);
