import { describe, it, expect } from 'vitest';
import { EXPORT_PRESETS, type ExportSettings } from '@novarec/shared';
import { buildFfmpegArgs, videoEncoderCandidates } from './ffmpeg-command.js';
import { nextRunnable, queueReducer, type ExportJob } from './export-queue.js';

function preset(id: string): ExportSettings {
  const found = EXPORT_PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`no preset ${id}`);
  return found.settings;
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

describe('buildFfmpegArgs', () => {
  const inputs = [{ path: 'in.mp4' }];

  describe('stream copy (record straight to a finished file)', () => {
    it('never re-encodes the video — that is the expensive part', () => {
      expect(flagValue(buildFfmpegArgs(preset('mp4-original'), inputs, 'out.mp4'), '-c:v')).toBe(
        'copy',
      );
      expect(flagValue(buildFfmpegArgs(preset('mkv-original'), inputs, 'out.mkv'), '-c:v')).toBe(
        'copy',
      );
    });

    it('copies audio into MKV but normalises it to AAC for MP4', () => {
      // Chromium can record Opus, which is legal inside MP4 but rejected by
      // QuickTime, most editors and some browsers. MKV carries it happily.
      expect(flagValue(buildFfmpegArgs(preset('mkv-original'), inputs, 'out.mkv'), '-c:a')).toBe(
        'copy',
      );
      expect(flagValue(buildFfmpegArgs(preset('mp4-original'), inputs, 'out.mp4'), '-c:a')).toBe(
        'aac',
      );
    });

    it('puts the MP4 index at the front so the file uploads and seeks', () => {
      const args = buildFfmpegArgs(preset('mp4-original'), inputs, 'out.mp4');
      expect(flagValue(args, '-movflags')).toBe('+faststart');
      // Matroska has no such problem and takes no such flag.
      expect(buildFfmpegArgs(preset('mkv-original'), inputs, 'out.mkv')).not.toContain('-movflags');
    });

    it('emits nothing that would force an encode', () => {
      // Any of these alongside `copy` makes FFmpeg refuse the command.
      const args = buildFfmpegArgs(preset('mp4-original'), inputs, 'out.mp4');
      for (const flag of ['-crf', '-preset', '-b:v', '-r', '-vf', '-filter_complex']) {
        expect(args).not.toContain(flag);
      }
      expect(args.join(' ')).not.toContain('libx264');
    });

    it('has no encoder candidates, so there is nothing to fall back to', () => {
      expect(videoEncoderCandidates(preset('mp4-original'))).toEqual([]);
    });

    it('writes MKV when that container is chosen', () => {
      const args = buildFfmpegArgs(preset('mkv-original'), inputs, 'out.mkv');
      expect(args[args.length - 1]).toBe('out.mkv');
      expect(flagValue(args, '-c:v')).toBe('copy');
      expect(flagValue(args, '-c:a')).toBe('copy');
    });

    it('keeps every track when copying several files, rather than dropping audio', () => {
      // FFmpeg's default selection takes ONE stream of each kind, so a
      // screen + mic + system-audio copy would silently lose an audio source.
      const multi = [
        { path: 'screen.mp4', role: 'screen' as const },
        { path: 'mic.mp4', role: 'audio' as const },
        { path: 'sys.mp4', role: 'audio' as const },
      ];
      const args = buildFfmpegArgs(preset('mkv-original'), multi, 'out.mkv');
      const maps = args.filter((a, i) => args[i - 1] === '-map');
      expect(maps).toEqual(['0', '1', '2']);
    });

    it('does not add explicit maps for a single-file recording', () => {
      const args = buildFfmpegArgs(preset('mp4-original'), inputs, 'out.mp4');
      expect(args).not.toContain('-map');
    });

    it('never composites — a filter graph would re-encode by definition', () => {
      const multi = [
        { path: 'screen.mp4', role: 'screen' as const },
        { path: 'mic.mp4', role: 'audio' as const },
        { path: 'sys.mp4', role: 'audio' as const },
      ];
      const args = buildFfmpegArgs(preset('mp4-original'), multi, 'out.mp4');
      expect(args).not.toContain('-filter_complex');
      expect(flagValue(args, '-c:v')).toBe('copy');
    });
  });

  describe('chapter metadata', () => {
    it('adds the metadata file as the LAST input and maps it', () => {
      const args = buildFfmpegArgs(preset('youtube'), inputs, 'out.mp4', undefined, 'chap.txt');
      expect(args.indexOf('-i', args.indexOf('in.mp4'))).toBeGreaterThan(0);
      expect(args).toContain('chap.txt');
      // Index 1 = the input after the single media input.
      expect(flagValue(args, '-map_metadata')).toBe('1');
      // ...and it must come after the media input, never before.
      expect(args.indexOf('chap.txt')).toBeGreaterThan(args.indexOf('in.mp4'));
    });

    it('maps metadata past every media input when compositing', () => {
      // Filter labels address inputs by index, so the metadata input has to sit
      // after all of them or the graph silently re-points to the wrong stream.
      const multi = [
        { path: 'screen.mp4', role: 'screen' as const },
        { path: 'mic.mp4', role: 'audio' as const },
        { path: 'sys.mp4', role: 'audio' as const },
      ];
      const args = buildFfmpegArgs(preset('youtube'), multi, 'out.mp4', undefined, 'chap.txt');
      expect(flagValue(args, '-map_metadata')).toBe('3');
      expect(args.indexOf('chap.txt')).toBeGreaterThan(args.indexOf('sys.mp4'));
      // The graph still refers to the media inputs by their original indices.
      const graph = flagValue(args, '-filter_complex') ?? '';
      expect(graph).toContain('[0:v]');
      expect(graph).toContain('[1:a]');
      expect(graph).toContain('[2:a]');
    });

    it('omits chapters entirely when none are supplied', () => {
      const args = buildFfmpegArgs(preset('youtube'), inputs, 'out.mp4');
      expect(args).not.toContain('-map_metadata');
    });

    it('skips chapters for GIF, which cannot carry them', () => {
      const args = buildFfmpegArgs(preset('gif'), inputs, 'out.gif', undefined, 'chap.txt');
      expect(args).not.toContain('chap.txt');
      expect(args).not.toContain('-map_metadata');
    });
  });

  it('builds a software H.264 CRF command with scale and fps', () => {
    const settings: ExportSettings = {
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      width: 1280,
      height: 720,
      fps: 30,
      rateControl: { mode: 'crf', crf: 23 },
      hardwareEncode: false,
    };
    const args = buildFfmpegArgs(settings, inputs, 'out.mp4');
    expect(flagValue(args, '-c:v')).toBe('libx264');
    expect(flagValue(args, '-crf')).toBe('23');
    expect(flagValue(args, '-vf')).toBe('scale=1280:720');
    expect(flagValue(args, '-r')).toBe('30');
    expect(flagValue(args, '-c:a')).toBe('aac');
    expect(args[args.length - 1]).toBe('out.mp4');
  });

  it('uses the hardware encoder and -cq when hardwareEncode is on', () => {
    const args = buildFfmpegArgs(preset('youtube'), inputs, 'out.mp4');
    expect(flagValue(args, '-c:v')).toBe('h264_nvenc');
    expect(flagValue(args, '-cq:v')).toBe('18');
  });

  it('emits an audio-only command with no video', () => {
    const args = buildFfmpegArgs(preset('audio'), inputs, 'out.mp3');
    expect(args).toContain('-vn');
    expect(args).not.toContain('-c:v');
    expect(flagValue(args, '-c:a')).toBe('libmp3lame');
    expect(flagValue(args, '-b:a')).toBe('192k');
  });

  it('builds a GIF command with palette scaling and no audio', () => {
    const args = buildFfmpegArgs(preset('gif'), inputs, 'out.gif');
    expect(args).toContain('-an');
    expect(args).not.toContain('-c:v');
    expect(flagValue(args, '-vf')).toContain('fps=15');
    expect(flagValue(args, '-vf')).toContain('flags=lanczos');
  });

  it('expands CBR into bitrate/maxrate/bufsize', () => {
    const settings: ExportSettings = {
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'none',
      width: null,
      height: 1080,
      fps: null,
      rateControl: { mode: 'cbr', bitrateKbps: 5000 },
      hardwareEncode: false,
    };
    const args = buildFfmpegArgs(settings, inputs, 'out.mp4');
    expect(flagValue(args, '-b:v')).toBe('5000k');
    expect(flagValue(args, '-maxrate')).toBe('5000k');
    expect(flagValue(args, '-bufsize')).toBe('10000k');
    expect(flagValue(args, '-vf')).toBe('scale=-2:1080'); // null width -> -2
  });

  it('stays on the simple path for a single screen (+audio) recording', () => {
    // Roles present but nothing to composite: no camera, one audio → no filter_complex.
    const args = buildFfmpegArgs(
      preset('youtube'),
      [{ path: 'screen.mp4', role: 'screen' }],
      'o.mp4',
    );
    expect(args).not.toContain('-filter_complex');
    expect(flagValue(args, '-vf')).toBe('scale=1920:1080');
  });

  it('overlays the camera picture-in-picture over the screen', () => {
    const args = buildFfmpegArgs(
      preset('youtube'),
      [
        { path: 'screen.mp4', role: 'screen' },
        { path: 'camera.mp4', role: 'camera' },
        { path: 'mic.mp4', role: 'audio' },
      ],
      'o.mp4',
    );
    const graph = flagValue(args, '-filter_complex');
    expect(graph).toBeDefined();
    expect(graph).toContain('[1:v]scale=320:-2[pip]'); // camera scaled to PiP
    expect(graph).toContain('overlay=main_w-overlay_w-24:main_h-overlay_h-24[vout]');
    expect(args).toContain('-map');
    expect(args).toContain('[vout]');
    expect(args).toContain('2:a'); // mic mapped as the audio stream
    expect(flagValue(args, '-c:v')).toBe('h264_nvenc');
  });

  it('offers a hardware→software encoder chain, software first when hw is off', () => {
    expect(videoEncoderCandidates(preset('youtube'))).toEqual([
      'h264_nvenc',
      'h264_qsv',
      'h264_amf',
      'libx264',
    ]);
    expect(videoEncoderCandidates({ ...preset('youtube'), hardwareEncode: false })).toEqual([
      'libx264',
    ]);
  });

  it('adds a fast preset for software x264 exports', () => {
    const args = buildFfmpegArgs({ ...preset('youtube'), hardwareEncode: false }, inputs, 'o.mp4');
    expect(flagValue(args, '-preset')).toBe('veryfast');
    expect(flagValue(args, '-c:v')).toBe('libx264');
  });

  it('uses per-encoder rate control when a specific encoder is chosen (QSV)', () => {
    const args = buildFfmpegArgs(preset('youtube'), inputs, 'o.mp4', 'h264_qsv');
    expect(flagValue(args, '-c:v')).toBe('h264_qsv');
    expect(flagValue(args, '-global_quality')).toBe('18');
    expect(args).not.toContain('-cq:v');
  });

  it('mixes multiple audio tracks with amix', () => {
    const args = buildFfmpegArgs(
      preset('youtube'),
      [
        { path: 'screen.mp4', role: 'screen' },
        { path: 'mic.mp4', role: 'audio' },
        { path: 'system.mp4', role: 'audio' },
      ],
      'o.mp4',
    );
    const graph = flagValue(args, '-filter_complex');
    expect(graph).toContain('[1:a][2:a]amix=inputs=2:normalize=0,alimiter=limit=0.95[aout]');
    expect(args).toContain('[aout]');
  });
});

describe('export queue', () => {
  const run = (actions: Parameters<typeof queueReducer>[1][]): ExportJob[] =>
    actions.reduce<ExportJob[]>((jobs, action) => queueReducer(jobs, action), []);

  it('walks a job through its lifecycle', () => {
    const jobs = run([
      { type: 'enqueue', id: 'j1', label: 'Export' },
      { type: 'start', id: 'j1' },
      { type: 'progress', id: 'j1', progress: 0.5 },
      { type: 'complete', id: 'j1' },
    ]);
    expect(jobs[0]).toMatchObject({ status: 'completed', progress: 1 });
  });

  it('ignores duplicate enqueues and refuses progress while paused', () => {
    const jobs = run([
      { type: 'enqueue', id: 'j1', label: 'A' },
      { type: 'enqueue', id: 'j1', label: 'A again' },
      { type: 'start', id: 'j1' },
      { type: 'pause', id: 'j1' },
      { type: 'progress', id: 'j1', progress: 0.9 },
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: 'paused', progress: 0 });
  });

  it('does not resurrect a cancelled job', () => {
    const jobs = run([
      { type: 'enqueue', id: 'j1', label: 'A' },
      { type: 'cancel', id: 'j1' },
      { type: 'start', id: 'j1' },
    ]);
    expect(jobs[0]?.status).toBe('cancelled');
  });

  it('runs one job at a time', () => {
    const jobs = run([
      { type: 'enqueue', id: 'a', label: 'A' },
      { type: 'enqueue', id: 'b', label: 'B' },
    ]);
    expect(nextRunnable(jobs)?.id).toBe('a');
    const running = queueReducer(jobs, { type: 'start', id: 'a' });
    expect(nextRunnable(running)).toBeNull();
  });
});
