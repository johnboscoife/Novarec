import { describe, it, expect } from 'vitest';
import type { Marker, RedactionZone } from '@novarec/shared';
import { activeRedactions, credentialRedactions, resolveRedactionRect } from './redaction.js';
import { markersToChapters } from './markers.js';
import { laserOpacityAt, visibleAnnotations, type Annotation } from './annotation.js';

const zone = (over: Partial<RedactionZone>): RedactionZone => ({
  id: 'z',
  rect: { x: 0, y: 0, width: 10, height: 10 },
  mode: 'blur',
  fromMs: 0,
  toMs: null,
  ...over,
});

describe('redaction', () => {
  it('selects zones active at a time (open-ended toMs stays on)', () => {
    const zones = [
      zone({ id: 'a', fromMs: 0, toMs: 1000 }),
      zone({ id: 'b', fromMs: 500, toMs: null }),
    ];
    expect(activeRedactions(zones, 200).map((z) => z.id)).toEqual(['a']);
    expect(activeRedactions(zones, 800).map((z) => z.id)).toEqual(['a', 'b']);
    expect(activeRedactions(zones, 5000).map((z) => z.id)).toEqual(['b']);
  });

  it('follows the live window when configured', () => {
    const winBounds = { x: 100, y: 100, width: 400, height: 300 };
    expect(resolveRedactionRect(zone({ follow: 'window' }), winBounds)).toEqual(winBounds);
    expect(resolveRedactionRect(zone({ follow: 'fixed' }), winBounds)).toEqual(zone({}).rect);
  });

  it('builds solid zones over detected credential UI', () => {
    const zones = credentialRedactions([{ x: 5, y: 6, width: 100, height: 20 }], 1000);
    expect(zones[0]?.mode).toBe('solid');
    expect(zones[0]?.fromMs).toBe(1000);
    expect(zones[0]?.toMs).toBeNull();
  });
});

describe('markers -> chapters', () => {
  const marker = (atMs: number, label: string): Marker => ({
    id: `m${atMs}`,
    atMs,
    label,
    color: '#fff',
  });

  it('sorts, prepends an intro, and dedupes by instant', () => {
    const chapters = markersToChapters(
      [marker(3000, 'Demo'), marker(1000, 'Setup'), marker(1000, 'dup')],
      10_000,
    );
    expect(chapters).toEqual([
      { title: 'Intro', startMs: 0 },
      { title: 'Setup', startMs: 1000 },
      { title: 'Demo', startMs: 3000 },
    ]);
  });

  it('drops markers outside the media length', () => {
    expect(markersToChapters([marker(20_000, 'late')], 10_000)).toEqual([]);
  });
});

describe('annotation laser fade', () => {
  const laser: Annotation = {
    id: 'l',
    tool: 'laser',
    color: '#f00',
    strokeWidth: 3,
    points: [{ x: 0, y: 0 }],
    createdMs: 1000,
  };

  it('fades from 1 to 0 over the fade window', () => {
    expect(laserOpacityAt(laser, 1000, 700)).toBe(1);
    expect(laserOpacityAt(laser, 1350, 700)).toBeCloseTo(0.5, 5);
    expect(laserOpacityAt(laser, 1800, 700)).toBe(0);
  });

  it('hides fully-faded lasers and future annotations, keeps persistent ones', () => {
    const pen: Annotation = { ...laser, id: 'p', tool: 'pen', createdMs: 500 };
    const future: Annotation = { ...laser, id: 'f', createdMs: 5000 };
    const visible = visibleAnnotations([laser, pen, future], 1800, 700).map((a) => a.id);
    expect(visible).toEqual(['p']); // laser faded, future not yet, pen stays
  });
});
