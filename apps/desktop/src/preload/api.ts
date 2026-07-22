import type {
  AppInfo,
  CaptureSettings,
  DisplayInfo,
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
}
