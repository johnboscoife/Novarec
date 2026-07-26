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

/**
 * Signatures FFmpeg emits when a *hardware encoder is unavailable* (no capable
 * GPU, driver/session limits, or an FFmpeg build without it) — as opposed to a
 * runtime failure (disk full, bad input) that every encoder will hit alike.
 */
function isEncoderInitError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return /unknown encoder|cannot load|not supported|no nvenc|no capable|nvenc|not available|cannot init|error initializing|failed to open encoder|openencode|no such device|device .* (not|unavailable)|impossible to open/.test(
    msg,
  );
}

export async function exportRecording(options: ExportRecordingOptions): Promise<string> {
  const inputs = options.inputs;

  // Walk the encoder candidates best-first (hardware → software). A machine
  // without a given hardware encoder (or an FFmpeg build lacking it) fails fast
  // on init and we drop to the next candidate; software always works. `undefined`
  // means "no video encode" (audio-only / GIF) — a single attempt.
  const candidates = videoEncoderCandidates(options.settings);
  const attempts: (string | undefined)[] = candidates.length > 0 ? candidates : [undefined];

  for (let i = 0; i < attempts.length; i += 1) {
    // Track whether this attempt made real progress: a failure *after* progress
    // is a runtime error (disk full, corrupt input) that the next, slower encoder
    // would hit identically — re-encoding from scratch just wastes minutes/hours.
    let progressed = false;
    const runOpts = {
      ...(options.onProgress
        ? {
            onProgress: (ms: number) => {
              if (ms > 0) progressed = true;
              options.onProgress?.(ms);
            },
          }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    };
    try {
      await runFfmpeg(
        options.ffmpegPath,
        buildFfmpegArgs(options.settings, inputs, options.outputPath, attempts[i]),
        runOpts,
      );
      return options.outputPath;
    } catch (error) {
      const isLast = i === attempts.length - 1;
      // Only fall through for an encoder-availability failure at init; a mid-
      // stream failure aborts immediately.
      const shouldFallback = options.onProgress ? !progressed : isEncoderInitError(error);
      if (options.signal?.aborted || isLast || !shouldFallback) throw error;
      // else: try the next (slower but more compatible) encoder.
    }
  }
  return options.outputPath;
}
