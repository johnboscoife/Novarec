import { useEffect, useRef, type PointerEvent, type ReactElement, type RefObject } from 'react';
import { SCENE_HEIGHT, SCENE_WIDTH, hitTest, inResizeHandle, type SceneSource } from './scene.js';

/**
 * Live scene compositor. Draws every source onto a 1920×1080 canvas each frame
 * (video for screen/camera, images, and text) using a shared media getter. When
 * `interactive`, the user can drag/resize the selected source directly on it.
 * The canvas element is exposed via `canvasRef` so Studio can `captureStream()`
 * the program output for recording.
 */
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
  getMedia,
  canvasRef,
  interactive = true,
  onSelect,
  onUpdate,
}: {
  sources: SceneSource[];
  selectedId: string | null;
  getMedia: (s: SceneSource) => CanvasImageSource | null;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  interactive?: boolean;
  onSelect?: (id: string | null) => void;
  onUpdate?: (id: string, patch: Partial<SceneSource>) => void;
}): ReactElement {
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const getMediaRef = useRef(getMedia);
  getMediaRef.current = getMedia;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    let raf = 0;
    const loop = (): void => {
      paint(
        canvasRef.current,
        sourcesRef.current,
        interactiveRef.current ? selectedRef.current : null,
        getMediaRef.current,
      );
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
    if (!interactive) return;
    const { x, y } = toScene(e);
    const sel = sources.find((s) => s.id === selectedId);
    if (sel && sel.visible && inResizeHandle(sel, x, y)) {
      dragRef.current = { mode: 'resize', id: sel.id, startX: x, startY: y, orig: sel };
      canvasRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    const hit = hitTest(sources, x, y);
    if (hit) {
      onSelect?.(hit.id);
      dragRef.current = { mode: 'move', id: hit.id, startX: x, startY: y, orig: hit };
      canvasRef.current?.setPointerCapture(e.pointerId);
    } else {
      onSelect?.(null);
    }
  }

  function onPointerMove(e: PointerEvent<HTMLCanvasElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = toScene(e);
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    if (drag.mode === 'move') {
      onUpdate?.(drag.id, { x: drag.orig.x + dx, y: drag.orig.y + dy });
    } else {
      onUpdate?.(drag.id, { width: drag.orig.width + dx, height: drag.orig.height + dy });
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
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? endDrag : undefined}
      onPointerCancel={interactive ? endDrag : undefined}
      className="w-full touch-none rounded-xl border border-app bg-black"
      style={{ aspectRatio: '16 / 9', cursor: interactive ? 'crosshair' : 'default' }}
    />
  );
}

function paint(
  canvas: HTMLCanvasElement | null,
  sources: readonly SceneSource[],
  selectedId: string | null,
  getMedia: (s: SceneSource) => CanvasImageSource | null,
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
    const media = getMedia(s);
    if (media) {
      try {
        ctx.save();
        if (s.shape !== 'rectangle') {
          ctx.beginPath();
          if (s.shape === 'circle') {
            ctx.ellipse(
              s.x + s.width / 2,
              s.y + s.height / 2,
              s.width / 2,
              s.height / 2,
              0,
              0,
              Math.PI * 2,
            );
          } else {
            const r = Math.min(s.width, s.height) * 0.12;
            ctx.roundRect(s.x, s.y, s.width, s.height, r);
          }
          ctx.clip();
        }
        ctx.drawImage(media, s.x, s.y, s.width, s.height);
        ctx.restore();
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
