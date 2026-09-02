import { spawn, spawnSync } from 'node:child_process';

/**
 * Runs the real FFmpeg binary. The argv comes from the pure `buildFfmpegArgs`;
 * this module owns process spawning and progress parsing. In production the
 * bundled static binary is used; in dev we fall back to an env override or PATH.
 */
export function resolveFfmpegPath(): string {
  return process.env['NOVAREC_FFMPEG'] ?? process.env['FFMPEG_PATH'] ?? 'ffmpeg';
}

/** Whether an FFmpeg binary is actually runnable (used to gate/skip work). */
export function ffmpegAvailable(ffmpegPath: string = resolveFfmpegPath()): boolean {
  try {
    return spawnSync(ffmpegPath, ['-version']).status === 0;
  } catch {
    return false;
  }
}

/** Parse an FFmpeg progress line (`time=HH:MM:SS.xx`) to elapsed milliseconds. */
export function parseFfmpegProgressMs(line: string): number | null {
  const match = /time=(\d+):(\d{2}):(\d{2})\.(\d+)/.exec(line);
  if (!match) return null;
  const [, h, m, s, frac] = match;
  const seconds = Number(h) * 3600 + Number(m) * 60 + Number(s);
  return seconds * 1000 + Math.round(Number(`0.${frac}`) * 1000);
}

/** How much stderr to retain for diagnostics (progress spam is enormous). */
const STDERR_HEAD_LIMIT = 8000;
const STDERR_TAIL_LIMIT = 16000;

/**
 * A status line FFmpeg rewrites in place (`frame=… fps=… time=… bitrate=…`).
 *
 * These are written with a bare CR and no newline, so splitting on `\r?\n`
 * returns the entire progress stream as ONE line — which then gets reported to
 * the user as "the error". They carry no diagnostic value: filter them out.
 */
function isProgressLine(line: string): boolean {
  return /(^|\s)(frame|size)=/.test(line) && /\b(time|bitrate|speed)=/.test(line);
}

/**
 * FFmpeg's closing summary. It is the LAST error-ish line but says nothing about
 * the cause — the specific line just above it does ("Invalid data found…",
 * "No space left on device"). Prefer the specific one.
 */
function isGenericTrailer(line: string): boolean {
  return /^(conversion failed!?|exiting normally|error (while |)(closing|writing trailer))/i.test(
    line,
  );
}

/** Pull the most useful line out of FFmpeg's stderr for an error message. */
export function extractFfmpegError(stderr: string): string {
  // Split on CR as well as LF — progress updates are CR-delimited.
  const lines = stderr
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !isProgressLine(l));
  const isError = (l: string): boolean =>
    /error|unknown|invalid|not found|no such|failed|denied|corrupt|truncat/i.test(l);
  const reversed = [...lines].reverse();
  const specific = reversed.find((l) => isError(l) && !isGenericTrailer(l));
  return specific ?? reversed.find(isError) ?? lines[lines.length - 1] ?? '';
}

/**
 * Windows hands back exit codes unsigned, so FFmpeg's -1 arrives as 4294967295
 * — a number that means nothing to anyone. Show the signed value.
 */
export function formatExitCode(code: number | null): string {
  if (code === null) return 'unknown';
  return String(code >= 0x80000000 ? code - 0x100000000 : code);
}

export interface RunFfmpegOptions {
  onProgress?: (elapsedMs: number) => void;
  signal?: AbortSignal;
}

export function runFfmpeg(
  ffmpegPath: string,
  args: readonly string[],
  options: RunFfmpegOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [...args], options.signal ? { signal: options.signal } : {});
    // FFmpeg's opening banner (inputs, streams, mapping) is the most diagnostic
    // part and is printed once, up front; the progress spam that follows would
    // evict it from any small ring buffer. Keep the head AND a generous tail.
    let stderrHead = '';
    let stderrTail = '';

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (stderrHead.length < STDERR_HEAD_LIMIT) {
        stderrHead = (stderrHead + text).slice(0, STDERR_HEAD_LIMIT);
      }
      stderrTail = (stderrTail + text).slice(-STDERR_TAIL_LIMIT);
      if (options.onProgress) {
        for (const line of text.split(/\r\n|\r|\n/)) {
          const ms = parseFfmpegProgressMs(line);
          if (ms !== null) options.onProgress(ms);
        }
      }
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      // Always say HOW it ended. Reporting only a stderr line (as this used to)
      // loses the difference between a real encode error, a non-zero exit with
      // no message, and the process being killed by a signal — and when the
      // progress spam was the only thing left in the buffer, it reported that.
      const how = signal !== null ? `killed by ${signal}` : `exit code ${formatExitCode(code)}`;
      const detail = extractFfmpegError(stderrTail) || extractFfmpegError(stderrHead);
      reject(new Error(detail ? `FFmpeg failed (${how}): ${detail}` : `FFmpeg failed (${how})`));
    });
  });
}
