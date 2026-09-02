import { describe, it, expect } from 'vitest';
import {
  virtualDesktopBounds,
  displayContainingPoint,
  displayForRect,
  clampRectToBounds,
  rectIntersection,
  splitRectByDisplays,
  snapValue,
  snapRectEdges,
  cropForRegion,
  overlayRectToVirtual,
  type DisplayInfo,
} from './geometry.js';

// Two-monitor, MIXED-DPI layout: A is 1080p @1x, B is 4K @2x (reports 1920 DIP
// wide, 3840 physical). B sits to the right of A in the virtual desktop.
const A: DisplayInfo = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
  primary: true,
};
const B: DisplayInfo = {
  id: 2,
  bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
  scaleFactor: 2,
  primary: false,
};
const DISPLAYS = [A, B];

describe('virtualDesktopBounds', () => {
  it('unions all display bounds in DIP space', () => {
    expect(virtualDesktopBounds(DISPLAYS)).toEqual({ x: 0, y: 0, width: 3840, height: 1080 });
  });

  it('handles displays with negative origins (secondary left of primary)', () => {
    const left: DisplayInfo = {
      id: 3,
      bounds: { x: -1280, y: -100, width: 1280, height: 720 },
      scaleFactor: 1,
      primary: false,
    };
    expect(virtualDesktopBounds([A, left])).toEqual({
      x: -1280,
      y: -100,
      width: 3200,
      height: 1180,
    });
  });
});

describe('displayContainingPoint', () => {
  it('resolves points to the right display', () => {
    expect(displayContainingPoint(DISPLAYS, 100, 100)?.id).toBe(1);
    expect(displayContainingPoint(DISPLAYS, 2000, 100)?.id).toBe(2);
  });

  it('returns null for points outside every display', () => {
    expect(displayContainingPoint(DISPLAYS, 5000, 5000)).toBeNull();
  });
});

describe('rectIntersection', () => {
  it('returns the overlapping rect', () => {
    expect(
      rectIntersection(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 50, y: 50, width: 100, height: 100 },
      ),
    ).toEqual({ x: 50, y: 50, width: 50, height: 50 });
  });

  it('returns null when disjoint', () => {
    expect(
      rectIntersection(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 100, y: 100, width: 10, height: 10 },
      ),
    ).toBeNull();
  });
});

describe('displayForRect', () => {
  it('picks the display with the largest overlap', () => {
    // 300px on A, 100px on B -> A wins.
    const region = { x: 1620, y: 200, width: 400, height: 300 };
    expect(displayForRect(DISPLAYS, region)?.id).toBe(1);
  });
});

describe('clampRectToBounds', () => {
  const vd = { x: 0, y: 0, width: 3840, height: 1080 };

  it('shifts an out-of-bounds rect back inside', () => {
    expect(clampRectToBounds({ x: -50, y: -20, width: 200, height: 100 }, vd)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  it('shrinks a rect larger than the bounds', () => {
    expect(clampRectToBounds({ x: 0, y: 0, width: 5000, height: 2000 }, vd)).toEqual({
      x: 0,
      y: 0,
      width: 3840,
      height: 1080,
    });
  });
});

describe('splitRectByDisplays (mixed-DPI cross-monitor capture)', () => {
  it('produces per-display physical crops with correct scaling', () => {
    // Region straddles A (1x) and B (2x): 1720..2120 DIP, 200..500 DIP tall.
    const region = { x: 1720, y: 200, width: 400, height: 300 };
    const slices = splitRectByDisplays(DISPLAYS, region);

    expect(slices).toHaveLength(2);

    const onA = slices.find((s) => s.displayId === 1);
    const onB = slices.find((s) => s.displayId === 2);

    // A @1x: crop is 1:1 and relative to A's origin (0,0).
    expect(onA?.physicalRect).toEqual({ x: 1720, y: 200, width: 200, height: 300 });
    // B @2x: crop is relative to B's origin (1920,0), scaled by 2.
    expect(onB?.physicalRect).toEqual({ x: 0, y: 400, width: 400, height: 600 });
  });

  it('returns a single slice for a region fully on one display', () => {
    const slices = splitRectByDisplays(DISPLAYS, { x: 100, y: 100, width: 200, height: 200 });
    expect(slices).toHaveLength(1);
    expect(slices[0]?.displayId).toBe(1);
  });
});

describe('snapValue', () => {
  it('snaps to the nearest target within the threshold', () => {
    expect(snapValue(1912, [1920, 0, 3840], 10)).toBe(1920);
  });

  it('leaves the value unchanged when no target is within the threshold', () => {
    expect(snapValue(1900, [1920, 0, 3840], 10)).toBe(1900);
  });
});

describe('snapRectEdges', () => {
  it('snaps left/right/top/bottom edges independently to nearby guides', () => {
    const snapped = snapRectEdges(
      { x: 1912, y: 5, width: 100, height: 100 },
      [1920, 0, 3840],
      [0, 1080],
      10,
    );
    // left 1912->1920; right 2012 (no guide within 10) stays; top 5->0; bottom 105 stays.
    expect(snapped).toEqual({ x: 1920, y: 0, width: 92, height: 105 });
  });
});

describe('cropForRegion', () => {
  // A is 1920x1080 DIP at the origin. `getDisplayMedia` hands back the WHOLE
  // display, at whatever resolution Chromium chose — the crop must be derived
  // from that frame size, never from the display's scale factor.
  it('maps a DIP region to frame pixels when the frame is 1:1 with DIP', () => {
    const crop = cropForRegion({ x: 100, y: 50, width: 640, height: 360 }, A.bounds, 1920, 1080);
    expect(crop).toEqual({ sx: 100, sy: 50, sw: 640, sh: 360, outWidth: 640, outHeight: 360 });
  });

  it('scales the crop when the captured frame is downscaled from the display', () => {
    // B is 1920 DIP wide but delivered at 1280 wide: every coordinate x2/3.
    const crop = cropForRegion({ x: 1920, y: 0, width: 960, height: 540 }, B.bounds, 1280, 720);
    expect(crop).toMatchObject({ sx: 0, sy: 0, sw: 640, sh: 360 });
  });

  it('offsets by the display origin so a region on a secondary monitor is not shifted', () => {
    const crop = cropForRegion({ x: 2020, y: 100, width: 400, height: 300 }, B.bounds, 1920, 1080);
    expect(crop).toMatchObject({ sx: 100, sy: 100, sw: 400, sh: 300 });
  });

  it('clips a region that hangs off the edge of the captured display', () => {
    const crop = cropForRegion({ x: 1720, y: 900, width: 400, height: 400 }, A.bounds, 1920, 1080);
    // Only the part on A survives: 200 wide, 180 tall.
    expect(crop).toMatchObject({ sx: 1720, sy: 900, sw: 200, sh: 180 });
  });

  it('returns null when the region does not touch the captured display', () => {
    expect(cropForRegion({ x: 2200, y: 10, width: 300, height: 300 }, A.bounds, 1920, 1080)).toBe(
      null,
    );
  });

  it('returns null when the region already covers the whole frame', () => {
    expect(cropForRegion(A.bounds, A.bounds, 1920, 1080)).toBe(null);
  });

  it('returns null for a degenerate (sub-pixel) region rather than a broken crop', () => {
    expect(cropForRegion({ x: 10, y: 10, width: 0.5, height: 0.5 }, A.bounds, 1920, 1080)).toBe(
      null,
    );
  });

  it('keeps native pixels for a small region instead of upscaling it', () => {
    const crop = cropForRegion({ x: 0, y: 0, width: 320, height: 240 }, A.bounds, 1920, 1080);
    expect(crop).toMatchObject({ outWidth: 320, outHeight: 240 });
  });

  it('downscales an oversized region to the output ceiling, preserving aspect', () => {
    // A 3840x2160 native capture, region = 3000x2000 of it, ceiling 1920x1080.
    const crop = cropForRegion(
      { x: 0, y: 0, width: 1500, height: 1000 },
      { x: 0, y: 0, width: 1920, height: 1080 },
      3840,
      2160,
    );
    expect(crop).toMatchObject({ sw: 3000, sh: 2000 });
    // fit = min(1920/3000, 1080/2000) = 0.54 -> 1620x1080
    expect(crop).toMatchObject({ outWidth: 1620, outHeight: 1080 });
  });

  it('always produces even output dimensions (H.264 requires them)', () => {
    const crop = cropForRegion({ x: 0, y: 0, width: 641, height: 361 }, A.bounds, 1920, 1080);
    expect(crop!.outWidth % 2).toBe(0);
    expect(crop!.outHeight % 2).toBe(0);
  });
});

describe('overlayRectToVirtual', () => {
  it('is the identity for an overlay on the display at the virtual origin', () => {
    const local = { x: 40, y: 60, width: 320, height: 200 };
    expect(overlayRectToVirtual(local, A.bounds)).toEqual(local);
  });

  it('translates by the display origin for a secondary monitor', () => {
    // B starts at x=1920: a rect 100px into B's overlay is at 2020 virtually.
    expect(overlayRectToVirtual({ x: 100, y: 50, width: 400, height: 300 }, B.bounds)).toEqual({
      x: 2020,
      y: 50,
      width: 400,
      height: 300,
    });
  });

  it('does NOT apply the display scale factor — overlay pixels are already DIP', () => {
    // B is a 2x display. A 400x300 selection on it is 400x300 DIP, not 800x600.
    const converted = overlayRectToVirtual({ x: 0, y: 0, width: 400, height: 300 }, B.bounds);
    expect(converted.width).toBe(400);
    expect(converted.height).toBe(300);
  });

  it('handles a monitor positioned left of / above the primary (negative origin)', () => {
    const left = { x: -1280, y: -100, width: 1280, height: 720 };
    expect(overlayRectToVirtual({ x: 20, y: 30, width: 100, height: 100 }, left)).toEqual({
      x: -1260,
      y: -70,
      width: 100,
      height: 100,
    });
  });

  it('round-trips into a crop that lands at the same place on the target display', () => {
    // Draw 100,50 400x300 on B's overlay -> virtual -> crop within B's frame.
    const virtual = overlayRectToVirtual({ x: 100, y: 50, width: 400, height: 300 }, B.bounds);
    const crop = cropForRegion(virtual, B.bounds, 1920, 1080);
    expect(crop).toMatchObject({ sx: 100, sy: 50, sw: 400, sh: 300 });
  });
});
