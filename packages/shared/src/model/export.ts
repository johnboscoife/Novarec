import { z } from 'zod';

/**
 * Export settings and presets. Shared because the export dialog (renderer) and
 * the FFmpeg command builder (encoder/main) both speak them across IPC.
 */
export const ContainerSchema = z.enum(['mp4', 'mkv', 'webm', 'mov', 'gif', 'mp3', 'wav']);
export type Container = z.infer<typeof ContainerSchema>;

/**
 * `copy` re-wraps the recorded stream into a container without re-encoding it.
 * That is what makes "stop and have a finished file" possible: it runs at disk
 * speed rather than encode speed, and cannot lose quality because no pixel is
 * touched.
 */
export const VideoCodecSchema = z.enum(['h264', 'hevc', 'av1', 'vp9', 'copy', 'none']);
export type VideoCodec = z.infer<typeof VideoCodecSchema>;

export const AudioCodecSchema = z.enum(['aac', 'opus', 'mp3', 'flac', 'copy', 'none']);
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

/**
 * Re-wrap what was recorded into a container, without re-encoding. Finishes in
 * seconds at disk speed and is bit-for-bit identical to the capture, which is
 * what lets a recording be usable the moment it stops.
 */
const streamCopy = (container: 'mp4' | 'mkv'): ExportSettings => ({
  container,
  videoCodec: 'copy',
  // MKV carries whatever was captured, so it is a true zero-touch copy.
  //
  // MP4 is fussier: Chromium can record Opus audio, which is legal inside MP4
  // but rejected by QuickTime, most editors and some browsers. So MP4 keeps the
  // VIDEO untouched — the expensive part — and normalises only the audio, which
  // is what makes the file open everywhere. That pass costs seconds, not the
  // minutes a video re-encode would.
  audioCodec: container === 'mkv' ? 'copy' : 'aac',
  width: null,
  height: null,
  fps: null,
  // Ignored for a copy, but the schema requires a value.
  rateControl: { mode: 'crf', crf: 0 },
  hardwareEncode: false,
});

/** Presets that finish a recording without re-encoding it. */
export const MP4_COPY_PRESET_ID = 'mp4-original';
export const MKV_COPY_PRESET_ID = 'mkv-original';

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: MP4_COPY_PRESET_ID, label: 'MP4 · no re-encode', settings: streamCopy('mp4') },
  { id: MKV_COPY_PRESET_ID, label: 'MKV · no re-encode (fastest)', settings: streamCopy('mkv') },
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
