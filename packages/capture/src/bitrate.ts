/**
 * How much bitrate a recording should be given.
 *
 * This matters more than anything else in the capture path. `MediaRecorder`
 * with no explicit bitrate falls back to roughly 2.5 Mbps whatever the
 * resolution — enough for a webcam, and visibly not enough for 1080p screen
 * content, where text goes soft and flat colour blocks up. Every recording made
 * without setting this was quietly capped there.
 */
export type RecordingQuality = 'balanced' | 'high' | 'best';

/**
 * Bits per pixel per frame.
 *
 * Screen content is unusually kind to a codec — large flat areas, few real
 * gradients — but unusually punishing about text, which is where artefacts are
 * obvious. These are chosen so that 1080p text stays crisp rather than to hit a
 * file-size target.
 */
const BITS_PER_PIXEL: Record<RecordingQuality, number> = {
  balanced: 0.09,
  high: 0.15,
  best: 0.24,
};

/** Below this even a small window looks poor; above it, nothing is gained. */
const MIN_BITRATE = 1_500_000;
const MAX_BITRATE = 80_000_000;

/**
 * Video bitrate in bits per second for a frame of `width`×`height` at `fps`.
 *
 * Frame rate is deliberately sub-linear: doubling the frame rate does not double
 * the information, because consecutive frames are more alike the faster they
 * come. Scaling it linearly would double the file for very little visible gain.
 */
export function recommendedVideoBitrate(
  width: number,
  height: number,
  fps: number,
  quality: RecordingQuality = 'high',
): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return MIN_BITRATE;
  }
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const pixels = width * height;
  // 30fps is the reference point; other rates move by the square root of their
  // ratio to it.
  const fpsFactor = Math.sqrt(safeFps / 30);
  const raw = pixels * 30 * fpsFactor * BITS_PER_PIXEL[quality];
  return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, raw)));
}

/** Audio bitrate. Speech is the case that matters; music is a bonus. */
export function recommendedAudioBitrate(quality: RecordingQuality = 'high'): number {
  if (quality === 'balanced') return 128_000;
  return quality === 'best' ? 256_000 : 192_000;
}
