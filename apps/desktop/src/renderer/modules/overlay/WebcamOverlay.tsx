import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import type { WebcamShape } from '@novarec/shared';

/**
 * The renderer side of the floating webcam window (loaded with `?overlay=webcam`).
 * Shows the live camera clipped to the chosen shape. The whole surface is a drag
 * region so the user can move it anywhere on screen; the main process resizes it.
 * Corners outside the shape are transparent, so the recording sees the shape.
 */
function radiusFor(shape: WebcamShape): string {
  if (shape === 'circle') return '50%';
  if (shape === 'rounded') return '18px';
  return '0';
}

export function WebcamOverlay(): ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [shape, setShape] = useState<WebcamShape>('circle');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [mirror, setMirror] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Make the window chrome fully transparent so only the shaped video shows.
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
  }, []);

  // Initial config from the launch query, then live updates from the main process.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('shape');
    if (s === 'circle' || s === 'rounded' || s === 'square') setShape(s);
    const d = params.get('deviceId');
    if (d) setDeviceId(d);
    const z = Number(params.get('zoom'));
    if (Number.isFinite(z) && z >= 1) setZoom(z);
    const m = params.get('mirror');
    if (m !== null) setMirror(m !== '0');
    return window.novarec.onWebcamConfig((config) => {
      setShape(config.shape);
      setDeviceId(config.deviceId);
      setZoom(config.zoom);
      setMirror(config.mirror);
    });
  }, []);

  // Acquire the camera, falling back to the default if the chosen one is gone,
  // and hot-swap if it's unplugged while live.
  useEffect(() => {
    let current: MediaStream | null = null;
    let cancelled = false;
    setError(null);

    const getCamera = async (): Promise<MediaStream> => {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
          audio: false,
        });
      } catch (e) {
        if (!deviceId) throw e;
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
    };

    const attach = async (): Promise<void> => {
      try {
        const s = await getCamera();
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        current?.getTracks().forEach((t) => t.stop());
        current = s;
        setError(null);
        const el = videoRef.current;
        if (el) {
          el.srcObject = s;
          void el.play().catch(() => undefined);
        }
        s.getVideoTracks().forEach((t) => {
          t.onended = () => {
            if (!cancelled) void attach();
          };
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Camera unavailable');
      }
    };

    void attach();
    return () => {
      cancelled = true;
      current?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);

  const radius = radiusFor(shape);
  const container: CSSProperties = {
    position: 'fixed',
    inset: 0,
    boxSizing: 'border-box',
    overflow: 'hidden',
    background: error ? 'rgba(10,10,15,0.92)' : 'transparent',
    border: '3px solid rgba(255,255,255,0.92)',
    borderRadius: radius,
    cursor: 'move',
  };
  const video: CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
    // Clip the video itself — a transformed <video> escapes the parent's
    // border-radius clip in Chromium, so the shape must live on the video too.
    borderRadius: radius,
    // Mirroring is a negative X scale, so it multiplies into the zoom rather
    // than composing as a separate transform. Zoom crops from the centre, which
    // is exactly where a pillarboxed camera hides its real picture.
    transform: `scale(${String(mirror ? -zoom : zoom)}, ${String(zoom)})`,
    transformOrigin: 'center',
  };

  return (
    <div className="wc-drag" style={container}>
      {error ? (
        <div
          style={{
            display: 'grid',
            placeItems: 'center',
            height: '100%',
            padding: 12,
            textAlign: 'center',
            color: '#f87171',
            font: '12px system-ui',
          }}
        >
          {error}
        </div>
      ) : (
        <video ref={videoRef} muted playsInline autoPlay style={video} />
      )}
    </div>
  );
}
