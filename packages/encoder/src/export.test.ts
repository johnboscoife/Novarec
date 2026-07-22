import { describe, it, expect } from 'vitest';
import { EXPORT_PRESETS, type ExportSettings } from '@novarec/shared';
import { buildFfmpegArgs } from './ffmpeg-command.js';
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
