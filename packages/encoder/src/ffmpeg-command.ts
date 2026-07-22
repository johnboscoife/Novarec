import type { AudioCodec, ExportSettings, RateControl, VideoCodec } from '@novarec/shared';

/**
 * Pure FFmpeg argument builder. Turning ExportSettings into a correct argv is
 * fiddly and easy to regress, so it's isolated here and unit-tested — no child
 * process, no binary. The main process feeds the result to the bundled FFmpeg.
 */
export interface FfmpegInput {
  path: string;
}

const VIDEO_ENCODERS: Record<Exclude<VideoCodec, 'none'>, { sw: string; hw: string }> = {
  h264: { sw: 'libx264', hw: 'h264_nvenc' },
  hevc: { sw: 'libx265', hw: 'hevc_nvenc' },
  av1: { sw: 'libaom-av1', hw: 'av1_nvenc' },
  vp9: { sw: 'libvpx-vp9', hw: 'libvpx-vp9' },
};

const AUDIO_ENCODERS: Record<Exclude<AudioCodec, 'none'>, string> = {
  aac: 'aac',
  opus: 'libopus',
  mp3: 'libmp3lame',
  flac: 'flac',
};

function scaleFilter(width: number | null, height: number | null): string | null {
  if (width === null && height === null) return null;
  return `scale=${width ?? -2}:${height ?? -2}`;
}

function rateControlArgs(rc: RateControl, hardware: boolean): string[] {
  if (rc.mode === 'crf') return hardware ? ['-cq:v', String(rc.crf)] : ['-crf', String(rc.crf)];
  if (rc.mode === 'cbr') {
    const rate = `${rc.bitrateKbps}k`;
    return ['-b:v', rate, '-maxrate', rate, '-bufsize', `${rc.bitrateKbps * 2}k`];
  }
  return ['-b:v', `${rc.bitrateKbps}k`]; // vbr
}

export function buildFfmpegArgs(
  settings: ExportSettings,
  inputs: readonly FfmpegInput[],
  outputPath: string,
): string[] {
  const args: string[] = ['-y'];
  for (const input of inputs) args.push('-i', input.path);

  const scale = scaleFilter(settings.width, settings.height);

  if (settings.container === 'gif') {
    const filters: string[] = [];
    if (settings.fps) filters.push(`fps=${settings.fps}`);
    if (scale) filters.push(`${scale}:flags=lanczos`);
    if (filters.length) args.push('-vf', filters.join(','));
    args.push('-an', outputPath);
    return args;
  }

  if (settings.videoCodec === 'none') {
    args.push('-vn');
  } else {
    const encoder = VIDEO_ENCODERS[settings.videoCodec];
    args.push('-c:v', settings.hardwareEncode ? encoder.hw : encoder.sw);
    args.push(...rateControlArgs(settings.rateControl, settings.hardwareEncode));
    if (settings.fps) args.push('-r', String(settings.fps));
    if (scale) args.push('-vf', scale);
  }

  if (settings.audioCodec === 'none') {
    args.push('-an');
  } else {
    args.push('-c:a', AUDIO_ENCODERS[settings.audioCodec]);
    if (settings.rateControl.mode !== 'crf' && settings.audioCodec !== 'flac') {
      args.push('-b:a', `${settings.rateControl.bitrateKbps}k`);
    }
  }

  args.push(outputPath);
  return args;
}
