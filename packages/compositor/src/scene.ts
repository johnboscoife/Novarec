import type { Layer } from '@novarec/shared';

/**
 * Scene-graph helpers over an ordered layer stack (index 0 = bottom). Pure and
 * immutable so Studio's scene edits are predictable and testable.
 */
export function visibleLayers(layers: readonly Layer[]): Layer[] {
  return layers.filter((l) => l.visible && l.opacity > 0);
}

/** Move a layer to a new z-index (clamped), returning a new array. */
export function reorderLayer(layers: readonly Layer[], layerId: string, toIndex: number): Layer[] {
  const from = layers.findIndex((l) => l.id === layerId);
  if (from === -1) return [...layers];
  const next = [...layers];
  const [moved] = next.splice(from, 1);
  if (!moved) return [...layers];
  const clamped = Math.min(Math.max(toIndex, 0), next.length);
  next.splice(clamped, 0, moved);
  return next;
}

export function setLayerVisible(
  layers: readonly Layer[],
  layerId: string,
  visible: boolean,
): Layer[] {
  return layers.map((l) => (l.id === layerId ? { ...l, visible } : l));
}

/** Topmost visible layer whose (unrotated) bounds contain the point — for hit-testing. */
export function topLayerAt(
  layers: readonly Layer[],
  point: { x: number; y: number },
  boundsOf: (layer: Layer) => { x: number; y: number; width: number; height: number },
): Layer | null {
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (!layer || !layer.visible) continue;
    const b = boundsOf(layer);
    if (point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height) {
      return layer;
    }
  }
  return null;
}
