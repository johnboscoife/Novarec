import { describe, it, expect } from 'vitest';
import { recommendedAudioBitrate, recommendedVideoBitrate } from './bitrate.js';

const mbps = (bits: number): number => bits / 1_000_000;

describe('recommendedVideoBitrate', () => {
  // The point of this module: MediaRecorder's own default is ~2.5 Mbps at ANY
  // resolution, which is what made 1080p screen text look soft.
  it('gives 1080p far more than the 2.5 Mbps default it used to get', () => {
    expect(mbps(recommendedVideoBitrate(1920, 1080, 30, 'high'))).toBeGreaterThan(6);
  });

  it('scales with pixel count', () => {
    const p720 = recommendedVideoBitrate(1280, 720, 30);
    const p1080 = recommendedVideoBitrate(1920, 1080, 30);
    const p2160 = recommendedVideoBitrate(3840, 2160, 30);
    expect(p1080).toBeGreaterThan(p720);
    expect(p2160).toBeGreaterThan(p1080);
  });

  it('rises with quality', () => {
    const balanced = recommendedVideoBitrate(1920, 1080, 30, 'balanced');
    const high = recommendedVideoBitrate(1920, 1080, 30, 'high');
    const best = recommendedVideoBitrate(1920, 1080, 30, 'best');
    expect(high).toBeGreaterThan(balanced);
    expect(best).toBeGreaterThan(high);
  });

  // Doubling the frame rate does not double the information — consecutive
  // frames are more alike the faster they arrive. Linear scaling would double
  // the file for very little visible gain.
  it('rises with frame rate but sub-linearly', () => {
    const at30 = recommendedVideoBitrate(1920, 1080, 30);
    const at60 = recommendedVideoBitrate(1920, 1080, 60);
    expect(at60).toBeGreaterThan(at30);
    expect(at60).toBeLessThan(at30 * 2);
  });

  it('never returns something unusable for a tiny window', () => {
    expect(recommendedVideoBitrate(160, 120, 30)).toBeGreaterThanOrEqual(1_500_000);
  });

  it('caps rather than asking for an absurd bitrate at 8K', () => {
    expect(recommendedVideoBitrate(7680, 4320, 60, 'best')).toBeLessThanOrEqual(80_000_000);
  });

  it('survives nonsense inputs instead of handing MediaRecorder a NaN', () => {
    for (const value of [NaN, Infinity, 0, -100]) {
      expect(Number.isFinite(recommendedVideoBitrate(value, 1080, 30))).toBe(true);
      expect(Number.isFinite(recommendedVideoBitrate(1920, value, 30))).toBe(true);
      expect(Number.isFinite(recommendedVideoBitrate(1920, 1080, value))).toBe(true);
    }
  });

  it('always returns a whole number of bits', () => {
    expect(Number.isInteger(recommendedVideoBitrate(1920, 1080, 30))).toBe(true);
  });
});

describe('recommendedAudioBitrate', () => {
  it('rises with quality and stays sensible for speech', () => {
    expect(recommendedAudioBitrate('balanced')).toBe(128_000);
    expect(recommendedAudioBitrate('high')).toBeGreaterThan(recommendedAudioBitrate('balanced'));
    expect(recommendedAudioBitrate('best')).toBeGreaterThan(recommendedAudioBitrate('high'));
  });
});
