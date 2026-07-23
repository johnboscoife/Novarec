import { describe, it, expect } from 'vitest';
import { clampSource, defaultSource, hitTest, inResizeHandle, SCENE_WIDTH } from './scene.js';

function boxSource(over: Partial<ReturnType<typeof defaultSource>>) {
  return { ...defaultSource('image', 'x'), ...over };
}

describe('scene hit-testing', () => {
  it('returns the top-most visible source under the point', () => {
    const a = boxSource({ id: 'a', x: 0, y: 0, width: 200, height: 200 });
    const b = boxSource({ id: 'b', x: 50, y: 50, width: 200, height: 200 });
    // b is later in the list → on top; the overlap point picks b.
    expect(hitTest([a, b], 100, 100)?.id).toBe('b');
    // a-only region picks a.
    expect(hitTest([a, b], 20, 20)?.id).toBe('a');
    // outside everything → null.
    expect(hitTest([a, b], 999, 999)).toBeNull();
  });

  it('skips hidden sources', () => {
    const a = boxSource({ id: 'a', x: 0, y: 0, width: 200, height: 200, visible: false });
    expect(hitTest([a], 100, 100)).toBeNull();
  });

  it('detects the bottom-right resize handle', () => {
    const rect = { x: 0, y: 0, width: 200, height: 200 };
    expect(inResizeHandle(rect, 195, 195)).toBe(true);
    expect(inResizeHandle(rect, 100, 100)).toBe(false);
  });
});

describe('clampSource', () => {
  it('enforces a minimum size and keeps the box partly on-canvas', () => {
    const tiny = clampSource(boxSource({ width: 5, height: 5 }));
    expect(tiny.width).toBeGreaterThanOrEqual(40);
    expect(tiny.height).toBeGreaterThanOrEqual(40);

    const offRight = clampSource(boxSource({ x: SCENE_WIDTH + 1000, width: 300, height: 300 }));
    expect(offRight.x).toBeLessThanOrEqual(SCENE_WIDTH - 60);
  });
});
