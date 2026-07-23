import type {
  AppInfo,
  CaptureSettings,
  ControlAction,
  DisplayInfo,
  HotkeyAction,
  IpcRequest,
  IpcResponse,
  RecordControlState,
  SavedRegion,
  SourceList,
  WebcamShape,
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
  setCaptureSource(
    payload: IpcRequest<'capture:setSource'>,
  ): Promise<IpcResponse<'capture:setSource'>>;
  setProbeMotion(
    payload: IpcRequest<'capture:probeMotion'>,
  ): Promise<IpcResponse<'capture:probeMotion'>>;
  showWebcam(payload: IpcRequest<'webcam:show'>): Promise<IpcResponse<'webcam:show'>>;
  hideWebcam(): Promise<IpcResponse<'webcam:hide'>>;
  onWebcamConfig(
    callback: (config: { deviceId: string | null; shape: WebcamShape; sizePx: number }) => void,
  ): () => void;

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

  // --- Export (Phase 7) ---
  runExport(payload: IpcRequest<'export:run'>): Promise<IpcResponse<'export:run'>>;
  revealPath(payload: IpcRequest<'shell:reveal'>): Promise<IpcResponse<'shell:reveal'>>;
  openExternal(
    payload: IpcRequest<'shell:openExternal'>,
  ): Promise<IpcResponse<'shell:openExternal'>>;
  onExportProgress(
    callback: (progress: { elapsedMs: number; totalMs: number }) => void,
  ): () => void;

  // --- App settings (Phase 10) ---
  getAppSettings(): Promise<IpcResponse<'settings:get'>>;
  saveAppSettings(payload: IpcRequest<'settings:save'>): Promise<IpcResponse<'settings:save'>>;

  // --- Google account (Meet) ---
  googleSignIn(): Promise<IpcResponse<'google:signIn'>>;
  googleSignOut(): Promise<IpcResponse<'google:signOut'>>;
  googleGetProfile(): Promise<IpcResponse<'google:getProfile'>>;
  googleCreateMeet(): Promise<IpcResponse<'google:createMeet'>>;

  // --- Global hotkeys (Phase 5) --- returns an unsubscribe function.
  onHotkey(callback: (action: HotkeyAction) => void): () => void;

  // --- Floating recording control ---
  showControls(): Promise<IpcResponse<'controls:show'>>;
  hideControls(): Promise<IpcResponse<'controls:hide'>>;
  sendControlCommand(
    payload: IpcRequest<'controls:command'>,
  ): Promise<IpcResponse<'controls:command'>>;
  publishRecordState(payload: IpcRequest<'controls:state'>): Promise<IpcResponse<'controls:state'>>;
  onControlsAction(callback: (action: ControlAction) => void): () => void;
  onControlsState(callback: (state: RecordControlState) => void): () => void;
}
