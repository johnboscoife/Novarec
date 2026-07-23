import { useEffect, useRef, useState, type ReactElement } from 'react';

/**
 * Live webcam preview shown while a camera track is enabled and we're not yet
 * recording. This both confirms the camera works (the old UI showed nothing, so
 * an enabled camera looked broken) and surfaces permission/busy errors visibly.
 *
 * The preview holds its own getUserMedia stream and releases it on unmount or
 * when it becomes inactive — importantly, that includes when recording starts,
 * so the recorder can acquire the same camera without a device-busy conflict.
 */
export function CameraPreview({
  deviceId,
  active,
}: {
  deviceId: string | null;
  active: boolean;
}): ReactElement | null {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return undefined;
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
  }, [deviceId, active]);

  if (!active) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-app bg-black">
      <div className="flex items-center justify-between border-b border-app bg-surface px-3 py-1.5">
        <span className="text-xs font-medium text-app2">Camera preview</span>
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-app">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
          live
        </span>
      </div>
      {error ? (
        <div className="p-4 text-xs text-red-400">
          {error}
          <p className="mt-1 text-muted-app">
            Close other apps using the camera, or check Windows camera permissions.
          </p>
        </div>
      ) : (
        <video
          ref={videoRef}
          muted
          playsInline
          className="aspect-video w-full bg-black object-cover"
        />
      )}
    </div>
  );
}
