import { describe, it, expect } from 'vitest';
import {
  activeRipples,
  easePoint,
  easeValue,
  projectPoint,
  pruneClicks,
  zoomedSourceRect,
} from './cursor-live.js';

describe('easeValue', () => {
  it('covers exactly half the distance in one half-life', () => {
    expect(easeValue(0, 100, 100, 100)).toBeCloseTo(50, 5);
  });

  it('covers three quarters in two half-lives', () => {
    expect(easeValue(0, 100, 200, 100)).toBeCloseTo(75, 5);
  });

  // The whole reason for half-life easing: the same setting must glide the same
  // way at 24fps and at 60fps, not snap at one and crawl at the other.
  it('reaches the same place after equal time regardless of frame rate', () => {
    let coarse = 0;
    for (let i = 0; i < 6; i += 1) coarse = easeValue(coarse, 100, 1000 / 6, 100);
    let fine = 0;
    for (let i = 0; i < 60; i += 1) fine = easeValue(fine, 100, 1000 / 60, 100);
    expect(coarse).toBeCloseTo(fine, 4);
  });

  it('snaps to the target for a zero or negative half-life', () => {
    expect(easeValue(0, 42, 16, 0)).toBe(42);
    expect(easeValue(0, 42, 0, 100)).toBe(42);
  });

  it('eases both axes of a point', () => {
    expect(easePoint({ x: 0, y: 0 }, { x: 100, y: 200 }, 100, 100)).toEqual({ x: 50, y: 100 });
  });
});

describe('zoomedSourceRect', () => {
  const W = 1920;
  const H = 1080;

  it('centres on the cursor when there is room', () => {
    const view = zoomedSourceRect(W, H, { x: 960, y: 540 }, 2);
    expect(view).toEqual({ x: 480, y: 270, width: 960, height: 540 });
  });

  it('shows the whole frame at 1x', () => {
    expect(zoomedSourceRect(W, H, { x: 100, y: 100 }, 1)).toEqual({
      x: 0,
      y: 0,
      width: W,
      height: H,
    });
  });

  // Without clamping, zooming near an edge draws past the source and the
  // recording gets black bands down the side.
  it('never leaves the frame when the cursor is at a corner', () => {
    const topLeft = zoomedSourceRect(W, H, { x: 0, y: 0 }, 2);
    expect(topLeft.x).toBe(0);
    expect(topLeft.y).toBe(0);

    const bottomRight = zoomedSourceRect(W, H, { x: W, y: H }, 2);
    expect(bottomRight.x + bottomRight.width).toBe(W);
    expect(bottomRight.y + bottomRight.height).toBe(H);
  });

  it('keeps the region inside the frame at every scale and position', () => {
    for (const scale of [1, 1.5, 2, 3, 4]) {
      for (const x of [-500, 0, 960, 1920, 5000]) {
        const view = zoomedSourceRect(W, H, { x, y: 540 }, scale);
        expect(view.x).toBeGreaterThanOrEqual(0);
        expect(view.x + view.width).toBeLessThanOrEqual(W + 1e-9);
      }
    }
  });

  it('treats a scale below 1 as no zoom rather than zooming out past the frame', () => {
    expect(zoomedSourceRect(W, H, { x: 960, y: 540 }, 0.5)).toEqual({
      x: 0,
      y: 0,
      width: W,
      height: H,
    });
  });
});

describe('projectPoint', () => {
  it('maps the view centre to the canvas centre', () => {
    const view = { x: 480, y: 270, width: 960, height: 540 };
    expect(projectPoint({ x: 960, y: 540 }, view, 1920, 1080)).toEqual({ x: 960, y: 540 });
  });

  // The ring has to track the picture, not the screen: when zoomed, a cursor
  // near the view's edge must draw near the canvas edge.
  it('scales up with the zoom so effects follow the image', () => {
    const view = { x: 480, y: 270, width: 960, height: 540 };
    expect(projectPoint({ x: 480, y: 270 }, view, 1920, 1080)).toEqual({ x: 0, y: 0 });
    expect(projectPoint({ x: 1440, y: 810 }, view, 1920, 1080)).toEqual({ x: 1920, y: 1080 });
  });
});

describe('activeRipples', () => {
  const clicks = [
    { atMs: 1000, x: 10, y: 20 },
    { atMs: 1400, x: 30, y: 40 },
  ];

  it('returns a ripple part-way through its life, fading as it grows', () => {
    const [ripple] = activeRipples(clicks, 1200, 400);
    expect(ripple?.progress).toBeCloseTo(0.5, 5);
    expect(ripple?.opacity).toBeCloseTo(0.25, 5);
    expect(ripple).toMatchObject({ x: 10, y: 20 });
  });

  it('drops clicks that have expired instead of drawing them invisibly', () => {
    expect(activeRipples(clicks, 2000, 400)).toHaveLength(0);
  });

  it('ignores clicks from the future', () => {
    expect(activeRipples(clicks, 500, 400)).toHaveLength(0);
  });

  it('returns every ripple still alive', () => {
    expect(activeRipples(clicks, 1500, 1000)).toHaveLength(2);
  });

  it('is empty for a zero duration rather than dividing by zero', () => {
    expect(activeRipples(clicks, 1000, 0)).toEqual([]);
  });
});

describe('pruneClicks', () => {
  it('keeps only clicks that can still be drawn', () => {
    const clicks = [
      { atMs: 0, x: 0, y: 0 },
      { atMs: 900, x: 1, y: 1 },
    ];
    // A long recording's click history must not grow into the draw loop.
    expect(pruneClicks(clicks, 1000, 400)).toEqual([{ atMs: 900, x: 1, y: 1 }]);
  });
});
