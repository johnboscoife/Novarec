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
  reportWebcamStatus(payload: IpcRequest<'webcam:status'>): Promise<IpcResponse<'webcam:status'>>;
  onWebcamStatus(callback: (status: IpcRequest<'webcam:status'>) => void): () => void;
  onWebcamConfig(
    callback: (config: {
      deviceId: string | null;
      label: string;
      shape: WebcamShape;
      sizePx: number;
      zoom: number;
      mirror: boolean;
    }) => void,
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
  revealRecordings(): Promise<IpcResponse<'recording:revealVault'>>;

  // --- Export (Phase 7) ---
  runExport(payload: IpcRequest<'export:run'>): Promise<IpcResponse<'export:run'>>;
  revealPath(payload: IpcRequest<'shell:reveal'>): Promise<IpcResponse<'shell:reveal'>>;
  openExternal(
    payload: IpcRequest<'shell:openExternal'>,
  ): Promise<IpcResponse<'shell:openExternal'>>;
  /** macOS Screen Recording permission; 'granted' elsewhere. */
  screenAccess(): Promise<IpcResponse<'system:screenAccess'>>;
  openScreenSettings(): Promise<IpcResponse<'system:openScreenSettings'>>;
  chooseExportFolder(
    payload: IpcRequest<'export:chooseFolder'>,
  ): Promise<IpcResponse<'export:chooseFolder'>>;
  exportHistory(): Promise<IpcResponse<'export:history'>>;
  renameExport(payload: IpcRequest<'export:rename'>): Promise<IpcResponse<'export:rename'>>;
  removeExport(
    payload: IpcRequest<'export:removeHistory'>,
  ): Promise<IpcResponse<'export:removeHistory'>>;
  recordingSize(payload: IpcRequest<'recording:size'>): Promise<IpcResponse<'recording:size'>>;
  deleteRawRecording(
    payload: IpcRequest<'recording:deleteRaw'>,
  ): Promise<IpcResponse<'recording:deleteRaw'>>;
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
  meetToken(payload: IpcRequest<'meet:token'>): Promise<IpcResponse<'meet:token'>>;

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

  addMarker(payload: IpcRequest<'recording:marker'>): Promise<IpcResponse<'recording:marker'>>;
  freeSpace(): Promise<IpcResponse<'recording:freeSpace'>>;
  saveSnapshot(
    payload: IpcRequest<'recording:snapshot'>,
  ): Promise<IpcResponse<'recording:snapshot'>>;
  startCursorTracking(): Promise<IpcResponse<'cursor:start'>>;
  stopCursorTracking(): Promise<IpcResponse<'cursor:stop'>>;
  onCursorSample(
    callback: (sample: { x: number; y: number; clicked: boolean }) => void,
  ): () => void;

  // --- Phone camera over Wi-Fi ---
  startPhoneSession(payload?: IpcRequest<'phone:start'>): Promise<IpcResponse<'phone:start'>>;
  stopPhoneSession(): Promise<IpcResponse<'phone:stop'>>;
  sendPhoneAnswer(payload: IpcRequest<'phone:answer'>): Promise<IpcResponse<'phone:answer'>>;
  sendPhoneIce(payload: IpcRequest<'phone:ice'>): Promise<IpcResponse<'phone:ice'>>;
  onPhoneEvent(callback: (event: PhoneEvent) => void): () => void;
}

/** Signalling and lifecycle messages main forwards from the phone. */
export type PhoneEvent =
  | { type: 'offer'; sdp: string }
  | { type: 'ice'; candidate: unknown }
  | { type: 'disconnected' }
  | { type: 'expired' };
