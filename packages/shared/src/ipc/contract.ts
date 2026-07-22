import { z } from 'zod';
import {
  CaptureSettingsSchema,
  DisplayInfoSchema,
  SavedRegionSchema,
  SourceListSchema,
} from '../model/capture.js';

/**
 * The single source of truth for every IPC message crossing the preload bridge.
 *
 * Non-negotiable rule: every IPC payload is validated with Zod at BOTH ends.
 * The main process validates the request before acting; the renderer validates
 * the response before trusting it. Channels are `invoke`/`handle` (request →
 * response) unless documented otherwise.
 *
 * Phase 0 ships only the handshake channels needed to prove the bridge works;
 * capture/record/meet/studio channels are added in their respective phases.
 */

export const PlatformSchema = z.enum(['win32', 'darwin', 'linux']);
export type Platform = z.infer<typeof PlatformSchema>;

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: PlatformSchema,
  electronVersion: z.string(),
  chromeVersion: z.string(),
  nodeVersion: z.string(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

export const PingRequestSchema = z.object({ sentAt: z.number() });
export const PingResponseSchema = z.object({ sentAt: z.number(), pongAt: z.number() });

/**
 * Channel contract. Each entry declares the Zod schema for its request and
 * response. `z.void()` marks a channel that takes no argument.
 */
export const ipcContract = {
  'app:getInfo': {
    request: z.void(),
    response: AppInfoSchema,
  },
  'app:ping': {
    request: PingRequestSchema,
    response: PingResponseSchema,
  },

  // --- Capture (Phase 1) ---
  'capture:getDisplays': {
    request: z.void(),
    response: z.array(DisplayInfoSchema),
  },
  'capture:listSources': {
    request: z.void(),
    response: SourceListSchema,
  },
  'capture:getSettings': {
    request: z.void(),
    response: CaptureSettingsSchema,
  },
  'capture:saveSettings': {
    request: CaptureSettingsSchema,
    response: CaptureSettingsSchema,
  },
  // Opens the region-selection overlay; resolves with the chosen region or
  // null if the user cancelled.
  'capture:beginRegionSelect': {
    request: z.void(),
    response: SavedRegionSchema.nullable(),
  },
} as const;

export type IpcContract = typeof ipcContract;
export type IpcChannel = keyof IpcContract;

export type IpcRequest<C extends IpcChannel> = z.infer<IpcContract[C]['request']>;
export type IpcResponse<C extends IpcChannel> = z.infer<IpcContract[C]['response']>;

/** All channel names as a runtime array (used to wire handlers/guards). */
export const IPC_CHANNELS = Object.keys(ipcContract) as IpcChannel[];
