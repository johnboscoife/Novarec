import type { AppInfo, IpcRequest, IpcResponse } from '@novarec/shared';

/**
 * The complete, explicit surface exposed to the renderer via contextBridge.
 * Kept minimal by design — every method maps to one validated IPC channel.
 * This interface has no Electron dependency, so the renderer can import it for
 * typing `window.novarec` without pulling in main-process types.
 */
export interface NovaRecApi {
  getInfo(): Promise<AppInfo>;
  ping(payload: IpcRequest<'app:ping'>): Promise<IpcResponse<'app:ping'>>;
}
