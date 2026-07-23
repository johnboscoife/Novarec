import type { ExportSettings } from '@novarec/shared';
import { buildFfmpegArgs, type FfmpegInput } from './ffmpeg-command.js';
import { runFfmpeg } from './ffmpeg-runner.js';

/**
 * Export a recording: the finalized per-track files (video, audio, …) are fed
 * to FFmpeg with the chosen settings to produce the final deliverable. Track
 * finalization (concatenating init + sealed fMP4 fragments) is done first by the
 * caller — it's the same byte-concat as crash recovery.
 */
export interface ExportRecordingOptions {
  ffmpegPath: string;
  inputs: readonly FfmpegInput[];
  settings: ExportSettings;
  outputPath: string;
  onProgress?: (elapsedMs: number) => void;
  signal?: AbortSignal;
}

export async function exportRecording(options: ExportRecordingOptions): Promise<string> {
  const inputs = options.inputs;
  const runOpts = {
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };

  try {
    await runFfmpeg(
      options.ffmpegPath,
      buildFfmpegArgs(options.settings, inputs, options.outputPath),
      runOpts,
    );
  } catch (error) {
    // Automatic software fallback: hardware encoders (e.g. h264_nvenc) aren't
    // present on every machine or in every FFmpeg build.
    if (!options.settings.hardwareEncode) throw error;
    const software = { ...options.settings, hardwareEncode: false };
    await runFfmpeg(
      options.ffmpegPath,
      buildFfmpegArgs(software, inputs, options.outputPath),
      runOpts,
    );
  }
  return options.outputPath;
}
