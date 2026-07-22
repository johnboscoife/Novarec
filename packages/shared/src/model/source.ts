import { z } from 'zod';
import { RectSchema } from './primitives.js';

export const SourceKindSchema = z.enum([
  'display',
  'window',
  'region',
  'camera',
  'microphone',
  'systemAudio',
  'image',
  'video',
  'browser',
  'text',
  'capture-card',
]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

/**
 * A thing NovaRec can capture or place on a scene. One `CaptureSource` shape
 * serves Record, Meet, and Studio — that shared vocabulary is the whole point
 * of the product. `bounds` is only meaningful for region capture.
 */
export const CaptureSourceSchema = z.object({
  id: z.string(),
  kind: SourceKindSchema,
  label: z.string(),
  deviceId: z.string().optional(),
  bounds: RectSchema.optional(),
  targetFps: z.number().positive(),
  audioLoopback: z.boolean().optional(),
});
export type CaptureSource = z.infer<typeof CaptureSourceSchema>;
