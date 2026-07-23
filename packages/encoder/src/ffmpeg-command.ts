import type { AudioCodec, ExportSettings, RateControl, VideoCodec } from '@novarec/shared';

/**
 * Pure FFmpeg argument builder. Turning ExportSettings into a correct argv is
 * fiddly and easy to regress, so it's isolated here and unit-tested — no child
 * process, no binary. The main process feeds the result to the bundled FFmpeg.
 */
export interface FfmpegInput {
  path: string;
  /**
   * What this input contributes to the export. Omitted for single-file exports
   * (the legacy path). When present on any input, the builder composites: the
   * camera is overlaid picture-in-picture on the screen, and multiple audio
   * tracks are mixed.
   */
  role?: 'screen' | 'camera' | 'audio';
}

/** Picture-in-picture camera size (px, width) and margin from the corner. */
const PIP_WIDTH = 320;
const PIP_MARGIN = 24;

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
  // Composite (camera PiP + audio mix) only when it's actually needed — a
  // camera to overlay, or more than one audio track to blend. Screen-only and
  // screen+single-audio recordings keep the simpler, proven single-map path,
  // where FFmpeg's default stream selection already does the right thing.
  const cameras = inputs.filter((i) => i.role === 'camera').length;
  const audios = inputs.filter((i) => i.role === 'audio').length;
  const needsComposite =
    settings.container !== 'gif' && ((cameras > 0 && settings.videoCodec !== 'none') || audios > 1);
  if (needsComposite) return buildCompositeArgs(settings, inputs, outputPath);

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

function videoCodecArgs(settings: ExportSettings): string[] {
  if (settings.videoCodec === 'none') return ['-vn'];
  const encoder = VIDEO_ENCODERS[settings.videoCodec];
  const out = ['-c:v', settings.hardwareEncode ? encoder.hw : encoder.sw];
  out.push(...rateControlArgs(settings.rateControl, settings.hardwareEncode));
  if (settings.fps) out.push('-r', String(settings.fps));
  return out;
}

function audioCodecArgs(settings: ExportSettings): string[] {
  if (settings.audioCodec === 'none') return ['-an'];
  const out = ['-c:a', AUDIO_ENCODERS[settings.audioCodec]];
  if (settings.rateControl.mode !== 'crf' && settings.audioCodec !== 'flac') {
    out.push('-b:a', `${settings.rateControl.bitrateKbps}k`);
  }
  return out;
}

/**
 * Multi-track export: overlay the camera on the screen (picture-in-picture,
 * bottom-right) and mix every audio track together. Builds one `-filter_complex`
 * graph and maps its labelled outputs explicitly, so stream selection is never
 * left to chance.
 */
function buildCompositeArgs(
  settings: ExportSettings,
  inputs: readonly FfmpegInput[],
  outputPath: string,
): string[] {
  const args: string[] = ['-y'];
  for (const input of inputs) args.push('-i', input.path);

  const screenIdx = inputs.findIndex((i) => i.role === 'screen');
  const cameraIdx = inputs.findIndex((i) => i.role === 'camera');
  const primaryVideoIdx = screenIdx >= 0 ? screenIdx : cameraIdx;
  const audioIdxs = inputs.flatMap((i, idx) => (i.role === 'audio' ? [idx] : []));

  const scale = scaleFilter(settings.width, settings.height);
  const chains: string[] = [];
  let videoMap: string | null = null;
  let audioMap: string | null = null;

  const wantVideo = settings.videoCodec !== 'none' && primaryVideoIdx >= 0;
  if (wantVideo) {
    const useCamera = cameraIdx >= 0 && cameraIdx !== primaryVideoIdx;
    if (useCamera) {
      let bg = `[${primaryVideoIdx}:v]`;
      if (scale) {
        chains.push(`[${primaryVideoIdx}:v]${scale}[bg]`);
        bg = '[bg]';
      }
      chains.push(`[${cameraIdx}:v]scale=${PIP_WIDTH}:-2[pip]`);
      chains.push(
        `${bg}[pip]overlay=main_w-overlay_w-${PIP_MARGIN}:main_h-overlay_h-${PIP_MARGIN}[vout]`,
      );
    } else {
      chains.push(`[${primaryVideoIdx}:v]${scale ?? 'null'}[vout]`);
    }
    videoMap = '[vout]';
  }

  const wantAudio = settings.audioCodec !== 'none' && audioIdxs.length > 0;
  if (wantAudio) {
    if (audioIdxs.length === 1) {
      audioMap = `${audioIdxs[0]}:a`;
    } else {
      const labels = audioIdxs.map((idx) => `[${idx}:a]`).join('');
      chains.push(`${labels}amix=inputs=${audioIdxs.length}:normalize=0[aout]`);
      audioMap = '[aout]';
    }
  }

  if (chains.length) args.push('-filter_complex', chains.join(';'));
  if (videoMap) args.push('-map', videoMap);
  if (audioMap) args.push('-map', audioMap);

  args.push(...(wantVideo ? videoCodecArgs(settings) : ['-vn']));
  args.push(...(wantAudio ? audioCodecArgs(settings) : ['-an']));

  args.push(outputPath);
  return args;
}
