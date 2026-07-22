import { contextBridge, ipcRenderer } from 'electron';
import type { NovaRecApi } from './api.js';

const api: NovaRecApi = {
  getInfo: () => ipcRenderer.invoke('app:getInfo'),
  ping: (payload) => ipcRenderer.invoke('app:ping', payload),
};

// contextIsolation is on, so this is the only channel the renderer can reach.
contextBridge.exposeInMainWorld('novarec', api);
