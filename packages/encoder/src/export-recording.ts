import type { ExportSettings } from '@novarec/shared';
import { buildFfmpegArgs, videoEncoderCandidates, type FfmpegInput } from './ffmpeg-command.js';
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

  // Walk the encoder candidates best-first (hardware → software). A machine
  // without a given hardware encoder (or an FFmpeg build lacking it) fails fast
  // on init and we drop to the next candidate; software always works. `undefined`
  // means "no video encode" (audio-only / GIF) — a single attempt.
  const candidates = videoEncoderCandidates(options.settings);
  const attempts: (string | undefined)[] = candidates.length > 0 ? candidates : [undefined];

  for (let i = 0; i < attempts.length; i += 1) {
    try {
      await runFfmpeg(
        options.ffmpegPath,
        buildFfmpegArgs(options.settings, inputs, options.outputPath, attempts[i]),
        runOpts,
      );
      return options.outputPath;
    } catch (error) {
      if (options.signal?.aborted || i === attempts.length - 1) throw error;
      // else: try the next (slower but more compatible) encoder.
    }
  }
  return options.outputPath;
}
