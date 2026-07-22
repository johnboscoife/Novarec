import { z } from 'zod';
import { FilterSchema, TransformSchema, TransitionSchema } from './primitives.js';

/** A single source placed on a scene, with its transform, filters, and flags. */
export const LayerSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  transform: TransformSchema,
  filters: z.array(FilterSchema),
  opacity: z.number().min(0).max(1),
  locked: z.boolean(),
  visible: z.boolean(),
});
export type Layer = z.infer<typeof LayerSchema>;

/** A Studio scene: an ordered stack of layers plus an in-transition. */
export const SceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  layers: z.array(LayerSchema),
  transitionIn: TransitionSchema,
});
export type Scene = z.infer<typeof SceneSchema>;
