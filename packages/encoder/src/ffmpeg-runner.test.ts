import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractFfmpegError,
  formatExitCode,
  ffmpegAvailable,
  parseFfmpegProgressMs,
  resolveFfmpegPath,
  runFfmpeg,
} from './ffmpeg-runner.js';
import { exportRecording, shouldTryNextEncoder } from './export-recording.js';
import type { ExportSettings } from '@novarec/shared';

describe('parseFfmpegProgressMs (pure)', () => {
  it('parses an FFmpeg time= field to milliseconds', () => {
    expect(parseFfmpegProgressMs('frame=30 q=28.0 size=10kB time=00:00:01.00 bitrate=1.0')).toBe(
      1000,
    );
    expect(parseFfmpegProgressMs('time=00:01:02.50 bitrate=x')).toBe(62500);
  });
  it('returns null for lines without a time field', () => {
    expect(parseFfmpegProgressMs('Press [q] to stop')).toBeNull();
  });
});

describe('extractFfmpegError (pure)', () => {
  it('surfaces the meaningful error line from stderr', () => {
    const stderr = "ffmpeg version 6.1\n  built with gcc\nUnknown encoder 'h264_nvenc'\n";
    expect(extractFfmpegError(stderr)).toContain("Unknown encoder 'h264_nvenc'");
  });
  it('falls back to the last line when nothing matches', () => {
    expect(extractFfmpegError('line one\nline two\n')).toBe('line two');
  });

  // Regression: FFmpeg rewrites its status line in place with a bare CR and no
  // newline. Splitting on /\r?\n/ returned the whole progress stream as one
  // "line", so a failed export reported a wall of `frame=... size=... speed=...`
  // instead of the actual error.
  it('ignores CR-delimited progress lines and finds the real error after them', () => {
    const progress =
      'frame=11729 fps= 72 q=26.0 size= 8448kB time=00:03:15.45 bitrate= 354.1kbits/s speed= 1.2x\r' +
      'frame=13831 fps= 76 q=26.0 size= 9728kB time=00:03:50.48 bitrate= 345.8kbits/s speed=1.27x\r';
    const stderr = `${progress}[mp4 @ 0000] Invalid data found when processing input\nConversion failed!\n`;
    const detail = extractFfmpegError(stderr);
    expect(detail).toContain('Invalid data found when processing input');
    expect(detail).not.toContain('bitrate=');
  });

  it('returns nothing usable when stderr is only progress spam', () => {
    const progress =
      'frame=11729 fps= 72 q=26.0 size= 8448kB time=00:03:15.45 bitrate= 354.1kbits/s speed= 1.2x\r';
    // Better to report the exit code alone than to quote a progress line as the error.
    expect(extractFfmpegError(progress)).toBe('');
  });
});

const ffmpeg = resolveFfmpegPath();
const hasFfmpeg = ffmpegAvailable(ffmpeg);
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe.skipIf(!hasFfmpeg)('export with real FFmpeg', () => {
  it(
    'transcodes a generated clip end to end and reports progress',
    { timeout: 60_000 },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'novarec-export-'));
      dirs.push(dir);
      const input = join(dir, 'input.mp4');
      const output = join(dir, 'out.mp4');

      // Generate a real 1-second test clip.
      await runFfmpeg(ffmpeg, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=1:size=320x240:rate=30',
        input,
      ]);

      // hardwareEncode: true exercises the automatic software fallback when the
      // hardware encoder (h264_nvenc) isn't available in this FFmpeg build.
      const settings: ExportSettings = {
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'none',
        width: 160,
        height: 120,
        fps: 30,
        rateControl: { mode: 'crf', crf: 28 },
        hardwareEncode: true,
      };

      let lastProgress = 0;
      await exportRecording({
        ffmpegPath: ffmpeg,
        inputs: [{ path: input }],
        settings,
        outputPath: output,
        onProgress: (ms) => {
          lastProgress = ms;
        },
      });

      expect((await stat(output)).size).toBeGreaterThan(0);
      expect(lastProgress).toBeGreaterThan(0);
    },
  );
});

describe('formatExitCode (pure)', () => {
  it('shows Windows unsigned exit codes as their signed value', () => {
    // FFmpeg's -1 arrives from Windows as 4294967295.
    expect(formatExitCode(4294967295)).toBe('-1');
  });

  it('passes ordinary codes through', () => {
    expect(formatExitCode(1)).toBe('1');
    expect(formatExitCode(0)).toBe('0');
    expect(formatExitCode(null)).toBe('unknown');
  });
});

describe('shouldTryNextEncoder (pure)', () => {
  const err = (m: string): Error => new Error(m);

  // Regression: a machine with no NVIDIA GPU fails h264_nvenc at init, and
  // FFmpeg reports that as an EPERM out of the filter graph. Matching
  // "Operation not permitted" as a filesystem problem made a missing driver
  // fail the entire export instead of falling back to QuickSync/software.
  it('falls back when a GPU encoder cannot open, despite the EPERM wording', () => {
    expect(
      shouldTryNextEncoder(
        'h264_nvenc',
        err('FFmpeg failed (exit code -1): Error while filtering: Operation not permitted'),
      ),
    ).toBe(true);
  });

  it('falls back for an unknown/unbuilt encoder', () => {
    expect(shouldTryNextEncoder('h264_qsv', err("Unknown encoder 'h264_qsv'"))).toBe(true);
  });

  it('falls back when a GPU encoder dies mid-encode', () => {
    expect(shouldTryNextEncoder('h264_amf', err('FFmpeg failed (exit code -1): device lost'))).toBe(
      true,
    );
  });

  it('does NOT fall back when the disk is full — every encoder hits that', () => {
    expect(shouldTryNextEncoder('h264_nvenc', err('No space left on device'))).toBe(false);
  });

  it('does NOT fall back from the software encoder — nothing slower remains', () => {
    expect(shouldTryNextEncoder('libx264', err('some mid-stream failure'))).toBe(false);
  });
});
