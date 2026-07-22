import { describe, it, expect } from 'vitest';
import {
  CaptureSettingsSchema,
  DEFAULT_CAPTURE_SETTINGS,
  DisplayInfoSchema,
  SavedRegionSchema,
} from './capture.js';

describe('capture settings persistence', () => {
  it('round-trips valid saved settings', () => {
    const settings = {
      targetFps: 60,
      resolution: { width: 1920, height: 1080 },
      region: {
        rect: { x: 100, y: 100, width: 800, height: 450 },
        displayId: 1,
        updatedAt: '2026-07-22T10:00:00.000Z',
      },
    };
    expect(CaptureSettingsSchema.parse(settings)).toEqual(settings);
  });

  it('accepts the documented defaults', () => {
    expect(() => CaptureSettingsSchema.parse(DEFAULT_CAPTURE_SETTINGS)).not.toThrow();
  });

  it('rejects an unsupported frame rate', () => {
    expect(
      CaptureSettingsSchema.safeParse({ ...DEFAULT_CAPTURE_SETTINGS, targetFps: 45 }).success,
    ).toBe(false);
  });

  it('allows a region with no owning display (spanning monitors)', () => {
    const region = {
      rect: { x: 1720, y: 200, width: 400, height: 300 },
      displayId: null,
      updatedAt: '2026-07-22T10:00:00.000Z',
    };
    expect(SavedRegionSchema.parse(region).displayId).toBeNull();
  });

  it('rejects a display with a non-positive scale factor', () => {
    const bad = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 0,
      primary: true,
    };
    expect(DisplayInfoSchema.safeParse(bad).success).toBe(false);
  });
});
