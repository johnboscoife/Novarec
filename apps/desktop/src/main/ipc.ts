import { app, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import {
  AppInfoSchema,
  PingRequestSchema,
  PingResponseSchema,
  type AppInfo,
  type Platform,
} from '@novarec/shared';

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
}
