/**
 * @novarec/compositor — the scene-graph and layer geometry shared by Studio,
 * Meet's program output, and the editor preview. The WebGL2 renderer (Phase 9
 * integration) draws what these pure functions describe.
 */
export const COMPOSITOR_PACKAGE = '@novarec/compositor' as const;

export * from './transform.js';
export * from './scene.js';
