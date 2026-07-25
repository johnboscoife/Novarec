import { app, dialog, ipcMain, shell } from 'electron';
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
import { setPendingCaptureSource } from './capture/display-media.js';
import { startProbeMotion, stopProbeMotion } from './capture/probe-motion.js';
import { showWebcam, hideWebcam } from './overlays/webcam-window.js';
import {
  showControls,
  hideControls,
  dispatchCommand,
  pushControlState,
} from './overlays/controls-window.js';
import { setConfirmOnExit, setRecordingActive, setStorageLocation } from './app-state.js';
import { buildAccessToken, grantForRoom } from './meet/livekit-token.js';
import { loadCaptureSettings, saveCaptureSettings } from './settings-store.js';
import {
  deleteRawRecording,
  listOrphans,
  pauseRecording,
  recover,
  recordingSize,
  recordingsVault,
  resumeRecording,
  startRecording,
  stopRecording,
  writeFragment,
  writeInit,
} from './recording/session.js';
import { runExport } from './recording/export.js';
import { listHistory, removeHistory, renameHistory } from './export-history-store.js';
import { loadAppSettings, saveAppSettings } from './app-settings-store.js';
import {
  signIn as googleSignIn,
  signOut as googleSignOut,
  getProfile as googleGetProfile,
  createMeet as googleCreateMeet,
} from './meet/google-auth.js';

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

  handleChannel('capture:setSource', (req) => {
    setPendingCaptureSource(req.sourceId, req.audio);
    return { ok: true as const };
  });

  handleChannel('capture:probeMotion', async (req) => {
    if (req.on) await startProbeMotion(req.bounds);
    else stopProbeMotion();
    return { ok: true as const };
  });

  handleChannel('webcam:show', (req) => {
    showWebcam(req);
    return { ok: true as const };
  });
  handleChannel('webcam:hide', () => {
    hideWebcam();
    return { ok: true as const };
  });

  handleChannel('controls:show', () => {
    showControls();
    return { ok: true as const };
  });
  handleChannel('controls:hide', () => {
    hideControls();
    return { ok: true as const };
  });
  handleChannel('controls:command', (req) => {
    dispatchCommand(req.action);
    return { ok: true as const };
  });
  handleChannel('controls:state', (req) => {
    setRecordingActive(req.state !== 'idle');
    pushControlState(req);
    return { ok: true as const };
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
  handleChannel('recording:revealVault', async () => {
    await shell.openPath(recordingsVault());
    return { ok: true as const };
  });

  // --- Export (Phase 7) --- manual handler so we can stream progress events.
  ipcMain.handle('export:run', async (event: IpcMainInvokeEvent, raw: unknown) => {
    const request = ipcContract['export:run'].request.parse(raw);
    const result = await runExport(request.recordingDir, request.settings, (elapsedMs, totalMs) => {
      event.sender.send('export:progress', { elapsedMs, totalMs });
    });
    return ipcContract['export:run'].response.parse(result);
  });
  handleChannel('shell:reveal', (req) => {
    shell.showItemInFolder(req.path);
    return { ok: true as const };
  });
  handleChannel('shell:openExternal', async (req) => {
    // Security: only ever hand http(s) URLs to the OS, never arbitrary schemes.
    if (!/^https?:\/\//i.test(req.url)) throw new Error('Only http(s) URLs can be opened');
    await shell.openExternal(req.url);
    return { ok: true as const };
  });

  handleChannel('export:chooseFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select a folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    const picked = result.canceled ? null : (result.filePaths[0] ?? null);
    return { path: picked };
  });
  handleChannel('export:history', () => listHistory());
  handleChannel('export:rename', (req) => renameHistory(req.id, req.name));
  handleChannel('export:removeHistory', (req) => removeHistory(req.id, req.deleteFile));
  handleChannel('recording:size', async (req) => ({ bytes: await recordingSize(req.dir) }));
  handleChannel('recording:deleteRaw', async (req) => ({
    freedBytes: await deleteRawRecording(req.dir),
  }));

  // --- App settings (Phase 10) ---
  handleChannel('settings:get', () => loadAppSettings());
  handleChannel('settings:save', async (req) => {
    const saved = await saveAppSettings(req);
    setConfirmOnExit(saved.confirmOnExit); // keep the sync exit-guard current
    setStorageLocation(saved.storageLocation); // keep the vault path current
    return saved;
  });

  // --- Google account (Meet) ---
  handleChannel('google:signIn', () => googleSignIn());
  handleChannel('google:signOut', async () => {
    await googleSignOut();
    return { ok: true as const };
  });
  handleChannel('google:getProfile', () => googleGetProfile());
  handleChannel('google:createMeet', async () => ({ url: await googleCreateMeet() }));

  // --- NovaRec meetings (LiveKit) ---
  handleChannel('meet:token', async (req) => {
    const settings = await loadAppSettings();
    if (!settings.livekitUrl || !settings.livekitApiKey || !settings.livekitApiSecret) {
      throw new Error('Add your LiveKit URL, API key and secret in Settings → Meetings first.');
    }
    const token = buildAccessToken(
      {
        apiKey: settings.livekitApiKey,
        apiSecret: settings.livekitApiSecret,
        identity: req.identity,
        ttlSeconds: 60 * 60,
        grant: grantForRoom(req.room),
        ...(req.name ? { name: req.name } : {}),
      },
      Math.floor(Date.now() / 1000),
    );
    return { token, room: req.room, url: settings.livekitUrl };
  });
}
