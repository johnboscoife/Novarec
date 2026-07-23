import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { ControlAction, HotkeyAction, RecordControlState, WebcamShape } from '@novarec/shared';
import type { NovaRecApi } from './api.js';

const api: NovaRecApi = {
  getInfo: () => ipcRenderer.invoke('app:getInfo'),
  ping: (payload) => ipcRenderer.invoke('app:ping', payload),

  getDisplays: () => ipcRenderer.invoke('capture:getDisplays'),
  listSources: () => ipcRenderer.invoke('capture:listSources'),
  getCaptureSettings: () => ipcRenderer.invoke('capture:getSettings'),
  saveCaptureSettings: (settings) => ipcRenderer.invoke('capture:saveSettings', settings),
  beginRegionSelect: () => ipcRenderer.invoke('capture:beginRegionSelect'),
  setCaptureSource: (payload) => ipcRenderer.invoke('capture:setSource', payload),
  setProbeMotion: (payload) => ipcRenderer.invoke('capture:probeMotion', payload),
  showWebcam: (payload) => ipcRenderer.invoke('webcam:show', payload),
  hideWebcam: () => ipcRenderer.invoke('webcam:hide'),
  onWebcamConfig: (callback) => {
    const listener = (
      _event: IpcRendererEvent,
      config: { deviceId: string | null; shape: WebcamShape; sizePx: number },
    ): void => callback(config);
    ipcRenderer.on('webcam:config', listener);
    return () => ipcRenderer.removeListener('webcam:config', listener);
  },

  startRecording: (payload) => ipcRenderer.invoke('recording:start', payload),
  writeInit: (payload) => ipcRenderer.invoke('recording:writeInit', payload),
  writeFragment: (payload) => ipcRenderer.invoke('recording:writeFragment', payload),
  pauseRecording: (payload) => ipcRenderer.invoke('recording:pause', payload),
  resumeRecording: (payload) => ipcRenderer.invoke('recording:resume', payload),
  stopRecording: (payload) => ipcRenderer.invoke('recording:stop', payload),
  listOrphans: () => ipcRenderer.invoke('recording:listOrphans'),
  recoverRecording: (payload) => ipcRenderer.invoke('recording:recover', payload),

  runExport: (payload) => ipcRenderer.invoke('export:run', payload),
  revealPath: (payload) => ipcRenderer.invoke('shell:reveal', payload),
  openExternal: (payload) => ipcRenderer.invoke('shell:openExternal', payload),

  getAppSettings: () => ipcRenderer.invoke('settings:get'),
  saveAppSettings: (payload) => ipcRenderer.invoke('settings:save', payload),

  googleSignIn: () => ipcRenderer.invoke('google:signIn'),
  googleSignOut: () => ipcRenderer.invoke('google:signOut'),
  googleGetProfile: () => ipcRenderer.invoke('google:getProfile'),
  googleCreateMeet: () => ipcRenderer.invoke('google:createMeet'),

  onExportProgress: (callback) => {
    const listener = (_event: IpcRendererEvent, progress: { elapsedMs: number; totalMs: number }) =>
      callback(progress);
    ipcRenderer.on('export:progress', listener);
    return () => ipcRenderer.removeListener('export:progress', listener);
  },

  onHotkey: (callback) => {
    const listener = (_event: IpcRendererEvent, action: HotkeyAction) => callback(action);
    ipcRenderer.on('hotkey:action', listener);
    return () => ipcRenderer.removeListener('hotkey:action', listener);
  },

  // --- Floating recording control ---
  showControls: () => ipcRenderer.invoke('controls:show'),
  hideControls: () => ipcRenderer.invoke('controls:hide'),
  sendControlCommand: (payload) => ipcRenderer.invoke('controls:command', payload),
  publishRecordState: (payload) => ipcRenderer.invoke('controls:state', payload),
  onControlsAction: (callback) => {
    const listener = (_event: IpcRendererEvent, action: ControlAction) => callback(action);
    ipcRenderer.on('controls:action', listener);
    return () => ipcRenderer.removeListener('controls:action', listener);
  },
  onControlsState: (callback) => {
    const listener = (_event: IpcRendererEvent, state: RecordControlState) => callback(state);
    ipcRenderer.on('controls:state-update', listener);
    return () => ipcRenderer.removeListener('controls:state-update', listener);
  },
};

// contextIsolation is on, so this is the only channel the renderer can reach.
contextBridge.exposeInMainWorld('novarec', api);
