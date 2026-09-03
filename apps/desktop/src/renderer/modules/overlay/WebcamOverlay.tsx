import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import type { WebcamShape } from '@novarec/shared';

/**
 * The renderer side of the floating webcam window (loaded with `?overlay=webcam`).
 * Shows the live camera clipped to the chosen shape. The whole surface is a drag
 * region so the user can move it anywhere on screen; the main process resizes it.
 * Corners outside the shape are transparent, so the recording sees the shape.
 */
/** Backoff for a camera that keeps dropping, instead of a tight retry loop. */
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;
const MAX_ATTEMPTS = 6;

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
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [message, setMessage] = useState<string | null>(null);

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

  // Open the CHOSEN camera, and keep it open across the device coming and
  // going. Two rules matter here:
  //
  //  1. Never substitute a different camera. Falling back to "whatever is
  //     default" when the chosen device won't open put an unrelated camera on
  //     screen — and into the recording — while the picker still named the one
  //     the user asked for.
  //  2. Retry with backoff, not in a loop. Windows' phone "connected camera"
  //     registers and unregisters as the phone connects, so its track ends
  //     repeatedly; re-acquiring immediately on every `ended` spun forever and
  //     never settled.
  useEffect(() => {
    let cancelled = false;
    let current: MediaStream | null = null;
    let attempt = 0;
    let timer: number | null = null;

    const clearTimer = (): void => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const retryLater = (why: string): void => {
      if (cancelled) return;
      if (attempt >= MAX_ATTEMPTS) {
        setStatus('error');
        setMessage(`${why} Choose another camera, or reconnect this one.`);
        return;
      }
      const waitMs = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
      attempt += 1;
      setStatus('connecting');
      setMessage(`${why} Retrying…`);
      timer = window.setTimeout(() => void attach(), waitMs);
    };

    const describe = (error: unknown): string => {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotReadableError') return 'That camera is in use by another app.';
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        return 'That camera is not available right now.';
      }
      if (name === 'NotAllowedError') return 'Camera access was blocked.';
      return 'That camera did not open.';
    };

    const attach = async (): Promise<void> => {
      clearTimer();
      try {
        const next = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
          audio: false,
        });
        if (cancelled) {
          next.getTracks().forEach((t) => t.stop());
          return;
        }
        current?.getTracks().forEach((t) => t.stop());
        current = next;
        attempt = 0;
        setStatus('live');
        setMessage(null);

        const el = videoRef.current;
        if (el) {
          el.srcObject = next;
          void el.play().catch(() => undefined);
        }

        next.getVideoTracks().forEach((track) => {
          track.onended = () => {
            if (!cancelled) retryLater('The camera disconnected.');
          };
          // A registered-but-not-streaming virtual camera reports itself muted
          // rather than failing, which otherwise looks like a frozen window.
          track.onmute = () => {
            if (!cancelled) setMessage('Waiting for the camera to send video…');
          };
          track.onunmute = () => {
            if (!cancelled) setMessage(null);
          };
        });
      } catch (error) {
        if (cancelled) return;
        retryLater(describe(error));
      }
    };

    setStatus('connecting');
    setMessage(null);
    void attach();
    return () => {
      cancelled = true;
      clearTimer();
      current?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);

  const radius = radiusFor(shape);
  const container: CSSProperties = {
    position: 'fixed',
    inset: 0,
    boxSizing: 'border-box',
    overflow: 'hidden',
    background: status === 'live' ? 'transparent' : 'rgba(10,10,15,0.92)',
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
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        style={{ ...video, visibility: status === 'live' ? 'visible' : 'hidden' }}
      />
      {status !== 'live' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            padding: 14,
            textAlign: 'center',
            color: status === 'error' ? '#f87171' : '#d4d4d4',
            font: '12px system-ui',
            lineHeight: 1.5,
          }}
        >
          {message ?? 'Starting camera…'}
        </div>
      )}
    </div>
  );
}
