import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractFfmpegError,
  ffmpegAvailable,
  parseFfmpegProgressMs,
  resolveFfmpegPath,
  runFfmpeg,
} from './ffmpeg-runner.js';
import { exportRecording } from './export-recording.js';
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
