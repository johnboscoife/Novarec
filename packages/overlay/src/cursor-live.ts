/**
 * Live cursor effects applied while recording: zoom toward the pointer, a
 * highlight ring, click ripples, and smoothed pointer motion.
 *
 * These are baked into the captured frames, so getting them wrong is permanent —
 * which is exactly why the geometry and timing live here, pure and tested,
 * rather than inline in a draw loop.
 */

// Reuse the shared shapes rather than declaring rivals: `Point` already exists
// for annotations, and `Rect` is the model's own.
import type { Rect } from '@novarec/shared';
import type { Point } from './annotation.js';

export type { Point, Rect };

/**
 * Move `current` toward `target` by a fixed HALF-LIFE rather than a fixed
 * fraction per frame. A per-frame fraction makes the easing speed depend on the
 * frame rate, so the same setting would glide at 60fps and snap at 24.
 */
export function easeValue(
  current: number,
  target: number,
  dtMs: number,
  halfLifeMs: number,
): number {
  if (halfLifeMs <= 0 || dtMs <= 0) return target;
  const factor = 1 - Math.pow(0.5, dtMs / halfLifeMs);
  return current + (target - current) * factor;
}

/** Ease a point on both axes with one half-life. */
export function easePoint(current: Point, target: Point, dtMs: number, halfLifeMs: number): Point {
  return {
    x: easeValue(current.x, target.x, dtMs, halfLifeMs),
    y: easeValue(current.y, target.y, dtMs, halfLifeMs),
  };
}

/**
 * The region of the source frame to draw when zoomed `scale`× toward `focus`.
 *
 * Clamped so the region never leaves the frame: without that, zooming near an
 * edge draws past the source and the recording gets black bands down the side —
 * the zoom slides instead of the picture.
 */
export function zoomedSourceRect(
  sourceWidth: number,
  sourceHeight: number,
  focus: Point,
  scale: number,
): Rect {
  const safeScale = Math.max(1, scale);
  const width = sourceWidth / safeScale;
  const height = sourceHeight / safeScale;
  const x = Math.min(Math.max(focus.x - width / 2, 0), Math.max(0, sourceWidth - width));
  const y = Math.min(Math.max(focus.y - height / 2, 0), Math.max(0, sourceHeight - height));
  return { x, y, width, height };
}

/**
 * Where a point in the SOURCE frame lands on the drawn canvas, given the region
 * being shown. Needed to draw the ring and ripples in the right place once the
 * picture is zoomed — they move with the image, not with the screen.
 */
export function projectPoint(
  point: Point,
  view: Rect,
  canvasWidth: number,
  canvasHeight: number,
): Point {
  return {
    x: ((point.x - view.x) / view.width) * canvasWidth,
    y: ((point.y - view.y) / view.height) * canvasHeight,
  };
}

export interface ClickMark {
  atMs: number;
  x: number;
  y: number;
}

export interface Ripple {
  x: number;
  y: number;
  /** 0..1 through its life; multiply by a pixel radius when drawing. */
  progress: number;
  /** Fades out as it expands. */
  opacity: number;
}

/**
 * Click ripples still alive at `nowMs`. Expired clicks are dropped rather than
 * drawn at zero opacity, so a long recording's click history cannot grow into
 * the draw loop.
 */
export function activeRipples(
  clicks: readonly ClickMark[],
  nowMs: number,
  durationMs: number,
): Ripple[] {
  if (durationMs <= 0) return [];
  const ripples: Ripple[] = [];
  for (const click of clicks) {
    const age = nowMs - click.atMs;
    if (age < 0 || age >= durationMs) continue;
    const progress = age / durationMs;
    ripples.push({
      x: click.x,
      y: click.y,
      progress,
      // Fade out on a curve so the ripple thins as it grows.
      opacity: (1 - progress) ** 2,
    });
  }
  return ripples;
}

/** Drop clicks that can no longer be drawn, so the buffer stays bounded. */
export function pruneClicks(
  clicks: readonly ClickMark[],
  nowMs: number,
  durationMs: number,
): ClickMark[] {
  return clicks.filter((c) => nowMs - c.atMs < durationMs);
}
