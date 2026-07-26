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

// Per codec: the software encoder and an ordered list of hardware encoders to
// try (NVIDIA → Intel QuickSync → AMD). The export runner walks the candidate
// list until one succeeds, so a machine without NVENC still gets fast QSV/AMF
// encoding, and everything ultimately falls back to the always-present software
// encoder.
const VIDEO_ENCODERS: Record<Exclude<VideoCodec, 'none'>, { sw: string; hw: string[] }> = {
  h264: { sw: 'libx264', hw: ['h264_nvenc', 'h264_qsv', 'h264_amf'] },
  hevc: { sw: 'libx265', hw: ['hevc_nvenc', 'hevc_qsv', 'hevc_amf'] },
  av1: { sw: 'libaom-av1', hw: ['av1_nvenc', 'av1_qsv'] },
  vp9: { sw: 'libvpx-vp9', hw: ['vp9_qsv'] },
};

function isSoftwareEncoder(encoder: string): boolean {
  return encoder.startsWith('lib');
}

/** Ordered list of concrete video encoders the runner should try, best first. */
export function videoEncoderCandidates(settings: ExportSettings): string[] {
  if (settings.videoCodec === 'none') return [];
  const entry = VIDEO_ENCODERS[settings.videoCodec];
  return settings.hardwareEncode ? [...entry.hw, entry.sw] : [entry.sw];
}

function resolveVideoEncoder(settings: ExportSettings, override: string | undefined): string {
  if (override) return override;
  const entry = VIDEO_ENCODERS[settings.videoCodec as Exclude<VideoCodec, 'none'>];
  return settings.hardwareEncode ? entry.hw[0]! : entry.sw;
}

/** Speed preset per encoder family — the big lever for fast software exports. */
function presetArgs(encoder: string): string[] {
  if (encoder === 'libx264' || encoder === 'libx265') return ['-preset', 'veryfast'];
  if (encoder.endsWith('_qsv')) return ['-preset', 'veryfast'];
  if (encoder.endsWith('_nvenc')) return ['-preset', 'p4'];
  return [];
}

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

/** Rate-control flags for a specific encoder (CRF-style flags differ per family). */
function rateControlArgs(rc: RateControl, encoder: string): string[] {
  if (rc.mode === 'crf') {
    if (isSoftwareEncoder(encoder)) return ['-crf', String(rc.crf)];
    if (encoder.endsWith('_qsv')) return ['-global_quality', String(rc.crf)];
    if (encoder.endsWith('_amf')) {
      return ['-rc', 'cqp', '-qp_i', String(rc.crf), '-qp_p', String(rc.crf)];
    }
    return ['-cq:v', String(rc.crf)]; // nvenc + sensible default
  }
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
  videoEncoder?: string,
): string[] {
  // Composite (camera PiP + audio mix) only when it's actually needed — a
  // camera to overlay, or more than one audio track to blend. Screen-only and
  // screen+single-audio recordings keep the simpler, proven single-map path,
  // where FFmpeg's default stream selection already does the right thing.
  const cameras = inputs.filter((i) => i.role === 'camera').length;
  const audios = inputs.filter((i) => i.role === 'audio').length;
  const needsComposite =
    settings.container !== 'gif' && ((cameras > 0 && settings.videoCodec !== 'none') || audios > 1);
  if (needsComposite) return buildCompositeArgs(settings, inputs, outputPath, videoEncoder);

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
    args.push(...videoCodecArgs(settings, resolveVideoEncoder(settings, videoEncoder)));
    if (scale) args.push('-vf', scale);
  }

  args.push(...audioCodecArgs(settings));
  args.push(outputPath);
  return args;
}

function videoCodecArgs(settings: ExportSettings, encoder: string): string[] {
  const out = ['-c:v', encoder];
  out.push(...presetArgs(encoder));
  out.push(...rateControlArgs(settings.rateControl, encoder));
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
  videoEncoder?: string,
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
      // Sum at full scale (normalize=0 keeps each source at its recorded level),
      // then a limiter tames the peaks so mic + system audio together can't clip.
      chains.push(`${labels}amix=inputs=${audioIdxs.length}:normalize=0,alimiter=limit=0.95[aout]`);
      audioMap = '[aout]';
    }
  }

  if (chains.length) args.push('-filter_complex', chains.join(';'));
  if (videoMap) args.push('-map', videoMap);
  if (audioMap) args.push('-map', audioMap);

  args.push(
    ...(wantVideo
      ? videoCodecArgs(settings, resolveVideoEncoder(settings, videoEncoder))
      : ['-vn']),
  );
  args.push(...(wantAudio ? audioCodecArgs(settings) : ['-an']));

  args.push(outputPath);
  return args;
}
