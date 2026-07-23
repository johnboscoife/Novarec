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
    return window.novarec.onWebcamConfig((config) => {
      setShape(config.shape);
      setDeviceId(config.deviceId);
    });
  }, []);

  // Acquire (and re-acquire on device change) the camera stream.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    setError(null);
    navigator.mediaDevices
      .getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const el = videoRef.current;
        if (el) {
          el.srcObject = s;
          void el.play().catch(() => undefined);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Camera unavailable');
      });
    return () => {
      cancelled = true;
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);

  const radius = radiusFor(shape);
  const container: CSSProperties = {
    position: 'fixed',
    inset: 0,
    boxSizing: 'border-box',
    overflow: 'hidden',
    background: error ? 'rgba(10,10,15,0.92)' : '#000',
    border: '3px solid rgba(255,255,255,0.92)',
    borderRadius: radius,
    cursor: 'move',
  };
  const video: CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
    transform: 'scaleX(-1)', // mirror, like every webcam preview
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
