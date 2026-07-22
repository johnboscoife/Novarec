/**
 * Annotation model for the overlay track (pen, arrow, shapes, highlighter,
 * text, laser). Drawn to the overlay track so annotations are erasable after
 * the fact. The laser pointer auto-fades — its opacity is a pure function of
 * time so the same math drives live rendering and export.
 */
export type AnnotationTool =
  'pen' | 'arrow' | 'rectangle' | 'ellipse' | 'highlighter' | 'text' | 'laser';

export interface Point {
  x: number;
  y: number;
}

export interface Annotation {
  id: string;
  tool: AnnotationTool;
  color: string;
  strokeWidth: number;
  points: Point[];
  text?: string;
  createdMs: number;
}

export const LASER_FADE_MS = 700;

/** Laser opacity: full at creation, linearly fading to 0 over `fadeMs`. */
export function laserOpacityAt(
  annotation: Annotation,
  atMs: number,
  fadeMs = LASER_FADE_MS,
): number {
  if (annotation.tool !== 'laser') return 1;
  const age = atMs - annotation.createdMs;
  if (age <= 0) return 1;
  if (age >= fadeMs) return 0;
  return 1 - age / fadeMs;
}

/** Annotations visible at a time: laser strokes disappear once fully faded. */
export function visibleAnnotations(
  annotations: readonly Annotation[],
  atMs: number,
  fadeMs = LASER_FADE_MS,
): Annotation[] {
  return annotations.filter((a) => {
    if (a.createdMs > atMs) return false;
    if (a.tool === 'laser') return laserOpacityAt(a, atMs, fadeMs) > 0;
    return true;
  });
}
