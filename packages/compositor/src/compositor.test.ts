import { describe, it, expect } from 'vitest';
import type { Layer, Transform } from '@novarec/shared';
import { croppedSourceRect, fitContain, fitCover, layerDestRect } from './transform.js';
import { reorderLayer, setLayerVisible, topLayerAt, visibleLayers } from './scene.js';

const transform = (over: Partial<Transform> = {}): Transform => ({
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  cropTop: 0,
  cropRight: 0,
  cropBottom: 0,
  cropLeft: 0,
  ...over,
});

const layer = (over: Partial<Layer>): Layer => ({
  id: 'l',
  sourceId: 's',
  transform: transform(),
  filters: [],
  opacity: 1,
  locked: false,
  visible: true,
  ...over,
});

describe('transform math', () => {
  it('crops source edges', () => {
    expect(
      croppedSourceRect(
        { width: 1920, height: 1080 },
        transform({ cropTop: 10, cropRight: 20, cropBottom: 30, cropLeft: 40 }),
      ),
    ).toEqual({ x: 40, y: 10, width: 1860, height: 1040 });
  });

  it('places and scales the destination rect', () => {
    expect(
      layerDestRect(
        { width: 100, height: 100 },
        transform({ x: 100, y: 50, scaleX: 2, scaleY: 2 }),
      ),
    ).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 200,
    });
  });

  it('fits contain (letterbox) and cover (fill)', () => {
    expect(fitContain({ width: 1000, height: 500 }, { width: 800, height: 800 })).toMatchObject({
      scale: 0.8,
      width: 800,
      height: 400,
      y: 200,
    });
    expect(fitCover({ width: 1000, height: 500 }, { width: 800, height: 800 })).toMatchObject({
      scale: 1.6,
      width: 1600,
      height: 800,
      x: -400,
    });
  });
});

describe('scene graph', () => {
  const layers = [
    layer({ id: 'a' }),
    layer({ id: 'b', visible: false }),
    layer({ id: 'c', opacity: 0 }),
  ];

  it('lists only visible, non-transparent layers', () => {
    expect(visibleLayers(layers).map((l) => l.id)).toEqual(['a']);
  });

  it('reorders a layer and toggles visibility immutably', () => {
    expect(reorderLayer(layers, 'a', 2).map((l) => l.id)).toEqual(['b', 'c', 'a']);
    expect(setLayerVisible(layers, 'b', true).find((l) => l.id === 'b')?.visible).toBe(true);
  });

  it('hit-tests the topmost layer under a point', () => {
    const stacked = [layer({ id: 'bottom' }), layer({ id: 'top' })];
    const bounds = () => ({ x: 0, y: 0, width: 100, height: 100 });
    expect(topLayerAt(stacked, { x: 50, y: 50 }, bounds)?.id).toBe('top');
    expect(topLayerAt(stacked, { x: 500, y: 500 }, bounds)).toBeNull();
  });
});
