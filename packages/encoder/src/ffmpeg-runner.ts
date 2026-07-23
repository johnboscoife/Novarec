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

export interface RunFfmpegOptions {
  onProgress?: (elapsedMs: number) => void;
  signal?: AbortSignal;
}

/** Pull the most useful line out of FFmpeg's stderr for an error message. */
export function extractFfmpegError(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const meaningful = [...lines]
    .reverse()
    .find((l) => /error|unknown|invalid|not found|no such|failed/i.test(l));
  return meaningful ?? lines[lines.length - 1] ?? '';
}

export function runFfmpeg(
  ffmpegPath: string,
  args: readonly string[],
  options: RunFfmpegOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [...args], options.signal ? { signal: options.signal } : {});
    let stderrTail = '';

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-4000);
      if (options.onProgress) {
        for (const line of text.split(/\r?\n/)) {
          const ms = parseFfmpegProgressMs(line);
          if (ms !== null) options.onProgress(ms);
        }
      }
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = extractFfmpegError(stderrTail);
      reject(
        new Error(detail ? `FFmpeg failed: ${detail}` : `FFmpeg exited with code ${String(code)}`),
      );
    });
  });
}
