import type { ExportSettings } from '@novarec/shared';
import { buildFfmpegArgs } from './ffmpeg-command.js';
import { runFfmpeg } from './ffmpeg-runner.js';

/**
 * Export a recording: the finalized per-track files (video, audio, …) are fed
 * to FFmpeg with the chosen settings to produce the final deliverable. Track
 * finalization (concatenating init + sealed fMP4 fragments) is done first by the
 * caller — it's the same byte-concat as crash recovery.
 */
export interface ExportRecordingOptions {
  ffmpegPath: string;
  inputs: readonly string[];
  settings: ExportSettings;
  outputPath: string;
  onProgress?: (elapsedMs: number) => void;
  signal?: AbortSignal;
}

export async function exportRecording(options: ExportRecordingOptions): Promise<string> {
  const args = buildFfmpegArgs(
    options.settings,
    options.inputs.map((path) => ({ path })),
    options.outputPath,
  );
  await runFfmpeg(options.ffmpegPath, args, {
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return options.outputPath;
}
