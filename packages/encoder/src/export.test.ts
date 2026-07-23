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
    expect(graph).toContain('[1:a][2:a]amix=inputs=2:normalize=0[aout]');
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
