import type { Scene } from '@novarec/shared';

/**
 * @novarec/compositor — the WebGL2 scene graph shared by Studio, Meet program
 * output, and the editor preview. Phase 9 implements the real renderer.
 */
export const COMPOSITOR_PACKAGE = '@novarec/compositor' as const;

export function countLayers(scene: Scene): number {
  return scene.layers.length;
}
