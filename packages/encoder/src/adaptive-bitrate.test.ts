import { describe, it, expect } from 'vitest';
import { adaptBitrate, DEFAULT_BITRATE_CONFIG } from './adaptive-bitrate.js';

const healthy = { droppedFrameRatio: 0, encoderLoadPct: 40 };

describe('adaptBitrate', () => {
  it('backs off when frames are dropping', () => {
    expect(adaptBitrate(4000, { droppedFrameRatio: 0.1, encoderLoadPct: 40 })).toBe(2800); // -30%
  });

  it('backs off when the encoder is saturated', () => {
    expect(adaptBitrate(4000, { droppedFrameRatio: 0, encoderLoadPct: 95 })).toBe(2800);
  });

  it('recovers slowly when healthy', () => {
    expect(adaptBitrate(4000, healthy)).toBe(4250); // +250
  });

  it('never drops below the floor or climbs above the ceiling', () => {
    expect(adaptBitrate(600, { droppedFrameRatio: 0.5, encoderLoadPct: 99 })).toBe(
      DEFAULT_BITRATE_CONFIG.minKbps,
    );
    expect(adaptBitrate(7900, healthy)).toBe(DEFAULT_BITRATE_CONFIG.maxKbps);
  });
});
