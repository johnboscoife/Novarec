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
