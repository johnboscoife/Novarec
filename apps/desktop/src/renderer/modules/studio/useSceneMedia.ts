import { useCallback, useEffect, useRef } from 'react';
import { mediaSignature, type SceneSource } from './scene.js';

/**
 * Shared media pool for the Studio canvases. Cameras/screens/images are acquired
 * ONCE per media signature and shared between the preview and program canvases,
 * so transitioning a source live never opens a second camera. Returns a getter
 * the compositors call each frame; acquisition readiness surfaces on the next
 * animation frame (no React re-render needed).
 */
interface MediaEntry {
  el?: HTMLVideoElement | HTMLImageElement;
  stream?: MediaStream;
  ready: boolean;
}

export function useSceneMedia(
  sources: SceneSource[],
): (s: SceneSource) => CanvasImageSource | null {
  const pool = useRef<Map<string, MediaEntry>>(new Map());
  const signature = sources
    .filter((s) => s.kind !== 'text')
    .map(mediaSignature)
    .sort()
    .join('|');

  useEffect(() => {
    const map = pool.current;
    const needed = new Set(sources.filter((s) => s.kind !== 'text').map(mediaSignature));

    for (const [key, entry] of map) {
      if (!needed.has(key)) {
        entry.stream?.getTracks().forEach((t) => t.stop());
        if (entry.el instanceof HTMLVideoElement) entry.el.remove();
        map.delete(key);
      }
    }

    for (const source of sources) {
      if (source.kind === 'text') continue;
      const key = mediaSignature(source);
      if (map.has(key)) continue;
      const entry: MediaEntry = { ready: false };
      map.set(key, entry);
      void acquire(source, entry, map, key);
    }
  }, [signature]);

  useEffect(
    () => () => {
      for (const [, entry] of pool.current) {
        entry.stream?.getTracks().forEach((t) => t.stop());
        if (entry.el instanceof HTMLVideoElement) entry.el.remove();
      }
      pool.current.clear();
    },
    [],
  );

  return useCallback((source: SceneSource): CanvasImageSource | null => {
    const entry = pool.current.get(mediaSignature(source));
    return entry?.ready ? (entry.el ?? null) : null;
  }, []);
}

async function acquire(
  source: SceneSource,
  entry: MediaEntry,
  map: Map<string, MediaEntry>,
  key: string,
): Promise<void> {
  try {
    if (source.kind === 'image' && source.dataUrl) {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('image load failed'));
        img.src = source.dataUrl ?? '';
      });
      if (map.get(key) !== entry) return;
      entry.el = img;
      entry.ready = true;
      return;
    }

    let stream: MediaStream;
    if (source.kind === 'camera') {
      stream = await navigator.mediaDevices.getUserMedia({
        video: source.deviceId ? { deviceId: { exact: source.deviceId } } : true,
        audio: false,
      });
    } else {
      await window.novarec.setCaptureSource({ sourceId: source.screenSourceId, audio: false });
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    }

    if (map.get(key) !== entry) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
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
