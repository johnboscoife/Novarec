import type {
  AppInfo,
  CaptureSettings,
  DisplayInfo,
  HotkeyAction,
  IpcRequest,
  IpcResponse,
  SavedRegion,
  SourceList,
} from '@novarec/shared';

/**
 * The complete, explicit surface exposed to the renderer via contextBridge.
 * Kept minimal by design — every method maps to one validated IPC channel.
 * This interface has no Electron dependency, so the renderer can import it for
 * typing `window.novarec` without pulling in main-process types.
 */
export interface NovaRecApi {
  getInfo(): Promise<AppInfo>;
  ping(payload: IpcRequest<'app:ping'>): Promise<IpcResponse<'app:ping'>>;

  // --- Capture (Phase 1) ---
  getDisplays(): Promise<DisplayInfo[]>;
  listSources(): Promise<SourceList>;
  getCaptureSettings(): Promise<CaptureSettings>;
  saveCaptureSettings(settings: CaptureSettings): Promise<CaptureSettings>;
  beginRegionSelect(): Promise<SavedRegion | null>;

  // --- Recording (Phase 2) ---
  startRecording(payload: IpcRequest<'recording:start'>): Promise<IpcResponse<'recording:start'>>;
  writeInit(
    payload: IpcRequest<'recording:writeInit'>,
  ): Promise<IpcResponse<'recording:writeInit'>>;
  writeFragment(
    payload: IpcRequest<'recording:writeFragment'>,
  ): Promise<IpcResponse<'recording:writeFragment'>>;
  pauseRecording(payload: IpcRequest<'recording:pause'>): Promise<IpcResponse<'recording:pause'>>;
  resumeRecording(
    payload: IpcRequest<'recording:resume'>,
  ): Promise<IpcResponse<'recording:resume'>>;
  stopRecording(payload: IpcRequest<'recording:stop'>): Promise<IpcResponse<'recording:stop'>>;
  listOrphans(): Promise<IpcResponse<'recording:listOrphans'>>;
  recoverRecording(
    payload: IpcRequest<'recording:recover'>,
  ): Promise<IpcResponse<'recording:recover'>>;

  // --- Global hotkeys (Phase 5) --- returns an unsubscribe function.
  onHotkey(callback: (action: HotkeyAction) => void): () => void;
}
