import { z } from 'zod';
import {
  CaptureSettingsSchema,
  ControlActionSchema,
  DisplayInfoSchema,
  RecordControlStateSchema,
  SavedRegionSchema,
  SourceListSchema,
  WebcamShapeSchema,
} from '../model/capture.js';
import {
  OrphanedRecordingSchema,
  RecoveryResultSchema,
  RecordingSummarySchema,
  TrackConfigSchema,
} from '../model/recording-io.js';
import { ExportSettingsSchema } from '../model/export.js';
import { AppSettingsSchema } from '../model/settings.js';
import { GoogleProfileSchema } from '../model/meet.js';

const Bytes = z.instanceof(Uint8Array);
const Ok = z.object({ ok: z.literal(true) });
const RecordingTrackRef = z.object({ recordingId: z.string(), trackId: z.string() });
const RecordingAt = z.object({ recordingId: z.string(), atMs: z.number().nonnegative() });

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
  // Tell main which source the next getDisplayMedia call should return.
  'capture:setSource': {
    request: z.object({ sourceId: z.string().nullable(), audio: z.boolean() }),
    response: Ok,
  },
  // Drive on-screen motion on the *captured* display during a capacity probe,
  // so a static screen doesn't read as "0 fps". The renderer passes the target
  // display's DIP bounds (it already maps each screen source to a display);
  // main just animates a bar there. `bounds: null` / `on: false` tears it down.
  'capture:probeMotion': {
    request: z.object({
      on: z.boolean(),
      bounds: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number().positive(),
          height: z.number().positive(),
        })
        .nullable(),
    }),
    response: Ok,
  },
  // Floating webcam overlay: a live camera window the user drags/resizes over
  // the screen. It's captured into the recording, so it appears in the export
  // exactly where/size/shape it was. `show` opens or updates; `hide` closes.
  'webcam:show': {
    request: z.object({
      deviceId: z.string().nullable(),
      shape: WebcamShapeSchema,
      sizePx: z.number().int().positive(),
    }),
    response: Ok,
  },
  'webcam:hide': { request: z.void(), response: Ok },

  // Floating recording control window. The main window shows/hides it and
  // publishes state; the control sends commands back (routed to the main window).
  'controls:show': { request: z.void(), response: Ok },
  'controls:hide': { request: z.void(), response: Ok },
  'controls:command': { request: z.object({ action: ControlActionSchema }), response: Ok },
  'controls:state': { request: RecordControlStateSchema, response: Ok },

  // --- Recording (Phase 2/3): renderer streams encoded data; main persists it.
  // Multi-track: each enabled track is an independent segment writer. ---
  'recording:start': {
    request: z.object({ tracks: z.array(TrackConfigSchema) }),
    response: z.object({
      recordingId: z.string(),
      dir: z.string(),
      tracks: z.array(z.object({ trackId: z.string(), dir: z.string() })),
    }),
  },
  'recording:writeInit': {
    request: RecordingTrackRef.extend({ bytes: Bytes }),
    response: Ok,
  },
  'recording:writeFragment': {
    request: RecordingTrackRef.extend({ bytes: Bytes, durationMs: z.number().nonnegative() }),
    response: z.object({ segmentCount: z.number().int().nonnegative() }),
  },
  'recording:pause': { request: RecordingAt, response: Ok },
  'recording:resume': { request: RecordingAt, response: Ok },
  'recording:stop': { request: RecordingAt, response: RecordingSummarySchema },
  'recording:listOrphans': { request: z.void(), response: z.array(OrphanedRecordingSchema) },
  'recording:recover': { request: z.object({ dir: z.string() }), response: RecoveryResultSchema },

  // --- Export (Phase 7) --- finalize tracks and run FFmpeg into one file.
  'export:run': {
    request: z.object({ recordingDir: z.string(), settings: ExportSettingsSchema }),
    response: z.object({ outputPath: z.string(), durationMs: z.number().nonnegative() }),
  },
  // Reveal a produced file in the OS file manager.
  'shell:reveal': { request: z.object({ path: z.string() }), response: Ok },
  // Open an http(s) URL in the user's default browser (e.g. a Google Meet link).
  'shell:openExternal': {
    request: z.object({ url: z.string().url() }),
    response: Ok,
  },

  // --- App settings (Phase 10) ---
  'settings:get': { request: z.void(), response: AppSettingsSchema },
  'settings:save': { request: AppSettingsSchema, response: AppSettingsSchema },

  // --- Google account (Meet) --- OAuth runs in main; the renderer only ever
  // sees the resulting profile, never tokens.
  'google:signIn': { request: z.void(), response: GoogleProfileSchema },
  'google:signOut': { request: z.void(), response: Ok },
  'google:getProfile': { request: z.void(), response: GoogleProfileSchema.nullable() },
  'google:createMeet': { request: z.void(), response: z.object({ url: z.string() }) },
} as const;

export type IpcContract = typeof ipcContract;
export type IpcChannel = keyof IpcContract;

export type IpcRequest<C extends IpcChannel> = z.infer<IpcContract[C]['request']>;
export type IpcResponse<C extends IpcChannel> = z.infer<IpcContract[C]['response']>;

/** All channel names as a runtime array (used to wire handlers/guards). */
export const IPC_CHANNELS = Object.keys(ipcContract) as IpcChannel[];
