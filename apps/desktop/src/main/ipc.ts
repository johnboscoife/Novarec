import { app, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import {
  AppInfoSchema,
  CaptureSettingsSchema,
  DisplayInfoSchema,
  PingRequestSchema,
  PingResponseSchema,
  SavedRegionSchema,
  SourceListSchema,
  ipcContract,
  type AppInfo,
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
  type Platform,
} from '@novarec/shared';
import { getDisplays, listSources } from './capture/enumerate.js';
import { beginRegionSelect } from './capture/region-window.js';
import { loadCaptureSettings, saveCaptureSettings } from './settings-store.js';
import {
  listOrphans,
  pauseRecording,
  recover,
  resumeRecording,
  startRecording,
  stopRecording,
  writeFragment,
  writeInit,
} from './recording/session.js';

/** Register an invoke handler that validates the request AND response with Zod. */
function handleChannel<C extends IpcChannel>(
  channel: C,
  handler: (request: IpcRequest<C>) => IpcResponse<C> | Promise<IpcResponse<C>>,
): void {
  const entry = ipcContract[channel];
  ipcMain.handle(channel, async (_event: IpcMainInvokeEvent, raw: unknown) => {
    const request = entry.request.parse(raw) as IpcRequest<C>;
    return entry.response.parse(await handler(request));
  });
}

function currentPlatform(): Platform {
  switch (process.platform) {
    case 'win32':
      return 'win32';
    case 'darwin':
      return 'darwin';
    default:
      return 'linux';
  }
}

/**
 * Register every IPC handler. Non-negotiable rule: validate every payload with
 * Zod on the main-process side. Requests are parsed before we act on them;
 * responses are parsed before they leave, so a contract drift fails loudly.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle('app:getInfo', (): AppInfo => {
    const info: AppInfo = {
      name: app.getName(),
      version: app.getVersion(),
      platform: currentPlatform(),
      electronVersion: process.versions.electron ?? 'unknown',
      chromeVersion: process.versions.chrome ?? 'unknown',
      nodeVersion: process.versions.node ?? 'unknown',
    };
    return AppInfoSchema.parse(info);
  });

  ipcMain.handle('app:ping', (_event: IpcMainInvokeEvent, raw: unknown) => {
    const request = PingRequestSchema.parse(raw);
    return PingResponseSchema.parse({ sentAt: request.sentAt, pongAt: Date.now() });
  });

  // --- Capture (Phase 1) ---
  ipcMain.handle('capture:getDisplays', () => z.array(DisplayInfoSchema).parse(getDisplays()));

  ipcMain.handle('capture:listSources', async () => SourceListSchema.parse(await listSources()));

  ipcMain.handle('capture:getSettings', async () =>
    CaptureSettingsSchema.parse(await loadCaptureSettings()),
  );

  ipcMain.handle('capture:saveSettings', async (_event: IpcMainInvokeEvent, raw: unknown) => {
    const settings = CaptureSettingsSchema.parse(raw);
    return CaptureSettingsSchema.parse(await saveCaptureSettings(settings));
  });

  ipcMain.handle('capture:beginRegionSelect', async () => {
    const region = await beginRegionSelect();
    return region === null ? null : SavedRegionSchema.parse(region);
  });

  // --- Recording (Phase 2/3) ---
  handleChannel('recording:start', (req) => startRecording(req.tracks));
  handleChannel('recording:writeInit', async (req) => {
    await writeInit(req.recordingId, req.trackId, req.bytes);
    return { ok: true as const };
  });
  handleChannel('recording:writeFragment', async (req) => ({
    segmentCount: await writeFragment(req.recordingId, req.trackId, req.bytes, req.durationMs),
  }));
  handleChannel('recording:pause', async (req) => {
    await pauseRecording(req.recordingId, req.atMs);
    return { ok: true as const };
  });
  handleChannel('recording:resume', async (req) => {
    await resumeRecording(req.recordingId, req.atMs);
    return { ok: true as const };
  });
  handleChannel('recording:stop', (req) => stopRecording(req.recordingId, req.atMs));
  handleChannel('recording:listOrphans', () => listOrphans());
  handleChannel('recording:recover', (req) => recover(req.dir));
}
