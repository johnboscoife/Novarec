import { z } from 'zod';

/**
 * Export settings and presets. Shared because the export dialog (renderer) and
 * the FFmpeg command builder (encoder/main) both speak them across IPC.
 */
export const ContainerSchema = z.enum(['mp4', 'webm', 'mov', 'gif', 'mp3', 'wav']);
export type Container = z.infer<typeof ContainerSchema>;

export const VideoCodecSchema = z.enum(['h264', 'hevc', 'av1', 'vp9', 'none']);
export type VideoCodec = z.infer<typeof VideoCodecSchema>;

export const AudioCodecSchema = z.enum(['aac', 'opus', 'mp3', 'flac', 'none']);
export type AudioCodec = z.infer<typeof AudioCodecSchema>;

export const RateControlSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('crf'), crf: z.number().int().min(0).max(63) }),
  z.object({ mode: z.literal('cbr'), bitrateKbps: z.number().int().positive() }),
  z.object({ mode: z.literal('vbr'), bitrateKbps: z.number().int().positive() }),
]);
export type RateControl = z.infer<typeof RateControlSchema>;

export const ExportSettingsSchema = z.object({
  container: ContainerSchema,
  videoCodec: VideoCodecSchema,
  audioCodec: AudioCodecSchema,
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  fps: z.number().positive().nullable(),
  rateControl: RateControlSchema,
  hardwareEncode: z.boolean(),
});
export type ExportSettings = z.infer<typeof ExportSettingsSchema>;

export interface ExportPreset {
  id: string;
  label: string;
  settings: ExportSettings;
}

/** A produced export file, tracked so it can be listed, renamed, or removed. */
export const ExportHistoryEntrySchema = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
  sizeBytes: z.number().nonnegative(),
  createdAtMs: z.number(),
  durationMs: z.number().nonnegative(),
});
export type ExportHistoryEntry = z.infer<typeof ExportHistoryEntrySchema>;

const h264 = (width: number, height: number, fps: number, crf: number): ExportSettings => ({
  container: 'mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
  width,
  height,
  fps,
  rateControl: { mode: 'crf', crf },
  hardwareEncode: true,
});

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'youtube', label: '1080p · MP4', settings: h264(1920, 1080, 60, 18) },
  { id: 'youtube4k', label: '4K · MP4', settings: h264(3840, 2160, 60, 18) },
  { id: 'linkedin', label: '1080p · 30 fps', settings: h264(1920, 1080, 30, 20) },
  { id: 'tiktok', label: 'Vertical · 1080×1920', settings: h264(1080, 1920, 30, 20) },
  {
    id: 'gif',
    label: 'GIF',
    settings: {
      container: 'gif',
      videoCodec: 'none',
      audioCodec: 'none',
      width: 640,
      height: null,
      fps: 15,
      rateControl: { mode: 'crf', crf: 0 },
      hardwareEncode: false,
    },
  },
  {
    id: 'audio',
    label: 'Audio only (MP3)',
    settings: {
      container: 'mp3',
      videoCodec: 'none',
      audioCodec: 'mp3',
      width: null,
      height: null,
      fps: null,
      rateControl: { mode: 'cbr', bitrateKbps: 192 },
      hardwareEncode: false,
    },
  },
  {
    id: 'lossless',
    label: 'Lossless master',
    settings: {
      container: 'mov',
      videoCodec: 'h264',
      audioCodec: 'flac',
      width: null,
      height: null,
      fps: null,
      rateControl: { mode: 'crf', crf: 0 },
      hardwareEncode: false,
    },
  },
];
