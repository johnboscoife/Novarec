import { useEffect, useRef, type PointerEvent, type ReactElement, type RefObject } from 'react';
import {
  SCENE_HEIGHT,
  SCENE_WIDTH,
  hitTest,
  inResizeHandle,
  mediaKey,
  type SceneSource,
  type SceneSourceKind,
} from './scene.js';

/**
 * Live scene compositor. Draws every source onto a 1920×1080 canvas each frame
 * (video for screen/camera, images, and text), and lets the user drag or resize
 * the selected source directly on the preview. The canvas element is exposed via
 * `canvasRef` so Studio can `captureStream()` it for recording.
 */
interface MediaEntry {
  key: string;
  kind: SceneSourceKind;
  el?: HTMLVideoElement | HTMLImageElement;
  stream?: MediaStream;
  ready: boolean;
}

interface DragState {
  mode: 'move' | 'resize';
  id: string;
  startX: number;
  startY: number;
  orig: SceneSource;
}

export function Compositor({
  sources,
  selectedId,
  onSelect,
  onUpdate,
  canvasRef,
}: {
  sources: SceneSource[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<SceneSource>) => void;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}): ReactElement {
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const mediaRef = useRef<Map<string, MediaEntry>>(new Map());
  const dragRef = useRef<DragState | null>(null);

  // Acquire/refresh media whenever a source's media identity changes.
  const mediaSig = sources.map(mediaKey).join('|');
  useEffect(() => {
    const map = mediaRef.current;

    for (const [id, entry] of map) {
      const src = sources.find((s) => s.id === id);
      if (!src || mediaKey(src) !== entry.key) {
        entry.stream?.getTracks().forEach((t) => t.stop());
        if (entry.el instanceof HTMLVideoElement) entry.el.remove();
        map.delete(id);
      }
    }

    for (const src of sources) {
      if (src.kind === 'text' || map.has(src.id)) continue;
      const entry: MediaEntry = { key: mediaKey(src), kind: src.kind, ready: false };
      map.set(src.id, entry);
      void acquireMedia(src, entry, map);
    }
    // sources intentionally read live; effect re-runs on media identity changes.
  }, [mediaSig]);

  // Tear down all media on unmount.
  useEffect(
    () => () => {
      for (const [, entry] of mediaRef.current) {
        entry.stream?.getTracks().forEach((t) => t.stop());
        if (entry.el instanceof HTMLVideoElement) entry.el.remove();
      }
      mediaRef.current.clear();
    },
    [],
  );

  // Render loop.
  useEffect(() => {
    let raf = 0;
    const loop = (): void => {
      paint(canvasRef.current, sourcesRef.current, selectedRef.current, mediaRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [canvasRef]);

  function toScene(e: PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * SCENE_WIDTH,
      y: ((e.clientY - r.top) / r.height) * SCENE_HEIGHT,
    };
  }

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>): void {
    const { x, y } = toScene(e);
    const sel = sources.find((s) => s.id === selectedId);
    if (sel && sel.visible && inResizeHandle(sel, x, y)) {
      dragRef.current = { mode: 'resize', id: sel.id, startX: x, startY: y, orig: sel };
      canvasRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    const hit = hitTest(sources, x, y);
    if (hit) {
      onSelect(hit.id);
      dragRef.current = { mode: 'move', id: hit.id, startX: x, startY: y, orig: hit };
      canvasRef.current?.setPointerCapture(e.pointerId);
    } else {
      onSelect(null);
    }
  }

  function onPointerMove(e: PointerEvent<HTMLCanvasElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = toScene(e);
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    if (drag.mode === 'move') {
      onUpdate(drag.id, { x: drag.orig.x + dx, y: drag.orig.y + dy });
    } else {
      onUpdate(drag.id, { width: drag.orig.width + dx, height: drag.orig.height + dy });
    }
  }

  function endDrag(e: PointerEvent<HTMLCanvasElement>): void {
    dragRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }

  return (
    <canvas
      ref={canvasRef}
      width={SCENE_WIDTH}
      height={SCENE_HEIGHT}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="w-full touch-none rounded-xl border border-app bg-black"
      style={{ aspectRatio: '16 / 9', cursor: 'crosshair' }}
    />
  );
}

async function acquireMedia(
  src: SceneSource,
  entry: MediaEntry,
  map: Map<string, MediaEntry>,
): Promise<void> {
  try {
    if (src.kind === 'image' && src.dataUrl) {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('image load failed'));
        img.src = src.dataUrl ?? '';
      });
      if (map.get(src.id) !== entry) return; // superseded
      entry.el = img;
      entry.ready = true;
      return;
    }

    let stream: MediaStream;
    if (src.kind === 'camera') {
      stream = await navigator.mediaDevices.getUserMedia({
        video: src.deviceId ? { deviceId: { exact: src.deviceId } } : true,
        audio: false,
      });
    } else {
      await window.novarec.setCaptureSource({ sourceId: src.screenSourceId, audio: false });
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    }

    if (map.get(src.id) !== entry) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    // Attached but hidden so it keeps decoding frames for drawImage.
    video.style.cssText =
      'position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0;pointer-events:none;';
    document.body.appendChild(video);
    await video.play().catch(() => undefined);
    entry.el = video;
    entry.stream = stream;
    entry.ready = true;
  } catch {
    entry.ready = false;
  }
}

function paint(
  canvas: HTMLCanvasElement | null,
  sources: readonly SceneSource[],
  selectedId: string | null,
  media: Map<string, MediaEntry>,
): void {
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;

  ctx.fillStyle = '#0b0b0f';
  ctx.fillRect(0, 0, SCENE_WIDTH, SCENE_HEIGHT);

  for (const s of sources) {
    if (!s.visible) continue;
    if (s.kind === 'text') {
      ctx.fillStyle = s.color;
      ctx.font = `700 ${s.fontSize}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(s.text, s.x, s.y);
      continue;
    }
    const entry = media.get(s.id);
    if (entry?.el && entry.ready) {
      try {
        ctx.drawImage(entry.el, s.x, s.y, s.width, s.height);
      } catch {
        // frame not ready yet
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(s.x, s.y, s.width, s.height);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '28px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${s.name}…`, s.x + 16, s.y + s.height / 2);
    }
  }

  const sel = sources.find((s) => s.id === selectedId);
  if (sel && sel.visible) {
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 4;
    ctx.strokeRect(sel.x, sel.y, sel.width, sel.height);
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(sel.x + sel.width - 28, sel.y + sel.height - 28, 28, 28);
  }
}
