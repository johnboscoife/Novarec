import { z } from 'zod';

/**
 * Geometry and visual primitives shared across capture, compositor, overlay,
 * and timeline. Kept intentionally small; individual packages extend the
 * open-ended pieces (e.g. `Filter.params`) without redefining the base shape.
 */

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type Rect = z.infer<typeof RectSchema>;

/** A layer transform in scene/compositor space. Rotation is in degrees. */
export const TransformSchema = z.object({
  x: z.number(),
  y: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
  rotation: z.number(),
  cropTop: z.number().nonnegative(),
  cropRight: z.number().nonnegative(),
  cropBottom: z.number().nonnegative(),
  cropLeft: z.number().nonnegative(),
});
export type Transform = z.infer<typeof TransformSchema>;

export const TransitionKindSchema = z.enum(['cut', 'fade', 'slide', 'stinger']);
export type TransitionKind = z.infer<typeof TransitionKindSchema>;

export const TransitionSchema = z.object({
  kind: TransitionKindSchema,
  durationMs: z.number().nonnegative(),
});
export type Transition = z.infer<typeof TransitionSchema>;

/**
 * A compositor filter. `kind` is an open string so the compositor package can
 * register new effects (chroma key, LUT, blur, …) without a schema change here;
 * `params` is validated by the effect's own schema at the point of use.
 */
export const FilterSchema = z.object({
  id: z.string(),
  kind: z.string(),
  enabled: z.boolean(),
  params: z.record(z.string(), z.unknown()),
});
export type Filter = z.infer<typeof FilterSchema>;
