/**
 * Automatic bitrate adaptation for live streaming: back off fast when frames
 * drop or the encoder is saturated, recover slowly when healthy. Pure so the
 * control logic is unit-tested without a live encoder.
 */
export interface StreamHealth {
  droppedFrameRatio: number; // 0..1 over the recent window
  encoderLoadPct: number; // 0..100
}

export interface BitrateConfig {
  minKbps: number;
  maxKbps: number;
  stepDownPct: number; // fraction to cut when unhealthy
  stepUpKbps: number; // amount to add when healthy
  dropThreshold: number; // dropped-frame ratio that triggers a back-off
  loadThreshold: number; // encoder-load % that triggers a back-off
}

export const DEFAULT_BITRATE_CONFIG: BitrateConfig = {
  minKbps: 500,
  maxKbps: 8000,
  stepDownPct: 0.3,
  stepUpKbps: 250,
  dropThreshold: 0.02,
  loadThreshold: 90,
};

export function adaptBitrate(
  currentKbps: number,
  health: StreamHealth,
  config: BitrateConfig = DEFAULT_BITRATE_CONFIG,
): number {
  const unhealthy =
    health.droppedFrameRatio > config.dropThreshold || health.encoderLoadPct > config.loadThreshold;

  if (unhealthy) {
    return Math.max(config.minKbps, Math.round(currentKbps * (1 - config.stepDownPct)));
  }
  return Math.min(config.maxKbps, currentKbps + config.stepUpKbps);
}
