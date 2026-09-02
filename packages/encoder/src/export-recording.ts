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
  /** FFMETADATA chapter file, when the recording has markers. */
  chaptersPath?: string;
  onProgress?: (elapsedMs: number) => void;
  signal?: AbortSignal;
}

/** Software encoders are the `lib*` family; everything else drives a GPU. */
function isHardwareEncoder(encoder: string | undefined): boolean {
  return encoder !== undefined && !encoder.startsWith('lib');
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).toLowerCase();
}

/**
 * The encoder could not be opened at all — no such GPU, no driver DLL, or an
 * FFmpeg build without it. ALWAYS worth trying the next candidate.
 *
 * This has to be checked BEFORE the environmental test, because FFmpeg reports a
 * failed encoder open as an EPERM out of the filter graph: "Error while
 * filtering: Operation not permitted". That phrase reads like a file-permission
 * problem but is nothing of the sort — matching it as environmental is what
 * broke the fallback and made a missing NVIDIA driver fail the whole export.
 */
export function isEncoderInitFailure(error: unknown): boolean {
  return /unknown encoder|cannot load|error while opening encoder|failed to open encoder|no capable|not supported|no such device|nothing was written into output file|error while filtering/.test(
    messageOf(error),
  );
}

/**
 * Failures that have nothing to do with the encoder — the disk is full or the
 * output path isn't writable. Every candidate hits these identically, so
 * re-encoding with a slower one just burns minutes before failing the same way.
 *
 * Kept deliberately narrow and file-specific: a vague errno phrase shared with
 * encoder failures does not belong here.
 */
export function isEnvironmentalError(error: unknown): boolean {
  return /no space left|disk full|permission denied|access is denied|read-only file system/.test(
    messageOf(error),
  );
}

/** Should a failure on `encoder` be retried with the next candidate? */
export function shouldTryNextEncoder(encoder: string | undefined, error: unknown): boolean {
  // Software is the last resort; if it failed, nothing slower will help.
  if (!isHardwareEncoder(encoder)) return false;
  // A GPU that cannot even open always deserves the next candidate.
  if (isEncoderInitFailure(error)) return true;
  return !isEnvironmentalError(error);
}

export async function exportRecording(options: ExportRecordingOptions): Promise<string> {
  const inputs = options.inputs;

  // Walk the encoder candidates best-first (hardware → software). `undefined`
  // means "no video encode" (audio-only / GIF) — a single attempt.
  const candidates = videoEncoderCandidates(options.settings);
  const attempts: (string | undefined)[] = candidates.length > 0 ? candidates : [undefined];

  for (let i = 0; i < attempts.length; i += 1) {
    const encoder = attempts[i];
    try {
      await runFfmpeg(
        options.ffmpegPath,
        buildFfmpegArgs(
          options.settings,
          inputs,
          options.outputPath,
          encoder,
          options.chaptersPath,
        ),
        {
          ...(options.onProgress ? { onProgress: options.onProgress } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        },
      );
      return options.outputPath;
    } catch (error) {
      const isLast = i === attempts.length - 1;
      if (options.signal?.aborted || isLast) throw error;

      // Fall back for ANY hardware-encoder failure, not just one at init: GPU
      // encoders also die MID-STREAM (driver reset, session limit, a laptop
      // switching GPUs, another app taking the encoder), and the software
      // encoder would have finished the job. The cost of being wrong is one
      // slower re-encode; the cost of not retrying is losing the export.
      // Progress restarts from zero for the new attempt.
      if (!shouldTryNextEncoder(encoder, error)) throw error;
    }
  }
  return options.outputPath;
}
