import type { Rect, Transform } from '@novarec/shared';

/**
 * Compositor layer math: where a source lands on the program canvas given its
 * transform (position, scale, crop) and helpers to fit a source into the canvas.
 * Pure so the geometry is unit-tested without a GPU.
 */
export interface Size {
  width: number;
  height: number;
}

/** The visible region of the source after cropping its edges. */
export function croppedSourceRect(source: Size, transform: Transform): Rect {
  const width = Math.max(0, source.width - transform.cropLeft - transform.cropRight);
  const height = Math.max(0, source.height - transform.cropTop - transform.cropBottom);
  return { x: transform.cropLeft, y: transform.cropTop, width, height };
}

/** The axis-aligned destination rect on the canvas (before rotation). */
export function layerDestRect(source: Size, transform: Transform): Rect {
  const cropped = croppedSourceRect(source, transform);
  return {
    x: transform.x,
    y: transform.y,
    width: cropped.width * transform.scaleX,
    height: cropped.height * transform.scaleY,
  };
}

interface Fit {
  x: number;
  y: number;
  scale: number;
  width: number;
  height: number;
}

function fit(source: Size, canvas: Size, pick: (a: number, b: number) => number): Fit {
  const scale = pick(canvas.width / source.width, canvas.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return { scale, width, height, x: (canvas.width - width) / 2, y: (canvas.height - height) / 2 };
}

/** Letterbox: fit entirely inside the canvas, preserving aspect. */
export function fitContain(source: Size, canvas: Size): Fit {
  return fit(source, canvas, Math.min);
}

/** Fill the canvas, preserving aspect (may crop overflow). */
export function fitCover(source: Size, canvas: Size): Fit {
  return fit(source, canvas, Math.max);
}
