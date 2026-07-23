/**
 * Studio scene model. A scene is an ordered list of sources composited onto a
 * fixed 1920×1080 canvas (last in the list draws on top). Pure geometry helpers
 * live here so hit-testing and clamping are unit-tested, independent of the
 * canvas/DOM.
 */
export const SCENE_WIDTH = 1920;
export const SCENE_HEIGHT = 1080;

export type SceneSourceKind = 'screen' | 'camera' | 'image' | 'text';

/** How a visual source is clipped when drawn (camera/image/screen). */
export type SceneShape = 'rectangle' | 'rounded' | 'circle';

export interface SceneSource {
  id: string;
  kind: SceneSourceKind;
  name: string;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: SceneShape;
  deviceId: string | null; // camera
  screenSourceId: string | null; // desktopCapturer id (screen)
  dataUrl: string | null; // image
  text: string;
  color: string;
  fontSize: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Top-most visible source containing the point, or null. */
export function hitTest(sources: readonly SceneSource[], x: number, y: number): SceneSource | null {
  for (let i = sources.length - 1; i >= 0; i -= 1) {
    const s = sources[i];
    if (!s || !s.visible) continue;
    if (x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height) return s;
  }
  return null;
}

/** Whether the point is within the bottom-right resize handle of a rect. */
export function inResizeHandle(rect: Rect, x: number, y: number, handle = 32): boolean {
  return (
    x >= rect.x + rect.width - handle &&
    x <= rect.x + rect.width + handle / 2 &&
    y >= rect.y + rect.height - handle &&
    y <= rect.y + rect.height + handle / 2
  );
}

/** Keep a source's box sane and at least partly on-canvas. */
export function clampSource(s: SceneSource): SceneSource {
  const width = Math.round(Math.max(40, Math.min(SCENE_WIDTH * 2, s.width)));
  const height = Math.round(Math.max(40, Math.min(SCENE_HEIGHT * 2, s.height)));
  const x = Math.round(Math.max(-width + 60, Math.min(SCENE_WIDTH - 60, s.x)));
  const y = Math.round(Math.max(-height + 60, Math.min(SCENE_HEIGHT - 60, s.y)));
  return { ...s, x, y, width, height };
}

/**
 * The underlying media a source draws — WITHOUT its instance id, so the same
 * camera/screen/image is acquired once and shared across the preview and program
 * canvases (a camera can't be opened twice reliably).
 */
export function mediaSignature(s: SceneSource): string {
  if (s.kind === 'camera') return `camera:${s.deviceId ?? 'default'}`;
  if (s.kind === 'screen') return `screen:${s.screenSourceId ?? 'default'}`;
  if (s.kind === 'image') return `image:${s.dataUrl?.slice(0, 96) ?? ''}`;
  return `text:${s.id}`;
}

let seq = 0;
/** A new source with sensible defaults for its kind. */
export function defaultSource(kind: SceneSourceKind, id: string): SceneSource {
  seq += 1;
  const base: SceneSource = {
    id,
    kind,
    name: `${kind[0]!.toUpperCase()}${kind.slice(1)} ${seq}`,
    visible: true,
    x: 0,
    y: 0,
    width: SCENE_WIDTH,
    height: SCENE_HEIGHT,
    shape: 'rectangle',
    deviceId: null,
    screenSourceId: null,
    dataUrl: null,
    text: 'Text',
    color: '#ffffff',
    fontSize: 96,
  };
  if (kind === 'camera') {
    // A square box + circle shape reads as a classic webcam bubble.
    return {
      ...base,
      shape: 'circle',
      width: 360,
      height: 360,
      x: SCENE_WIDTH - 400,
      y: SCENE_HEIGHT - 400,
    };
  }
  if (kind === 'image') {
    return {
      ...base,
      width: 640,
      height: 360,
      x: (SCENE_WIDTH - 640) / 2,
      y: (SCENE_HEIGHT - 360) / 2,
    };
  }
  if (kind === 'text') {
    return { ...base, width: 800, height: 160, x: 80, y: 80 };
  }
  return base; // screen fills the canvas
}
