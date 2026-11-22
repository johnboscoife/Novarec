import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrackConfig } from '@novarec/shared';
import { useAppStore } from '../../store.js';
import { MultiTrackRecorder, type RecorderOptions } from './recorder.js';

export type RecordingState = 'idle' | 'recording' | 'paused';

export interface RecorderControls {
  state: RecordingState;
  elapsedMs: number;
  segmentCount: number;
  error: string | null;
  lastRecordingDir: string | null;
  /** Resolves true once recording, false if it failed or was cancelled. */
  start(
    configs: TrackConfig[],
    targetFps: number,
    providedStreams?: Record<string, MediaStream>,
    options?: RecorderOptions,
  ): Promise<boolean>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  setMicMuted(muted: boolean): void;
  /** Zoom the capture toward the pointer, or back out. */
  setZoomed(zoomed: boolean): void;
  /** Save a still of the frame being recorded; resolves with its path. */
  snapshot(): Promise<string | null>;
  /** Bookmark the current moment; becomes a chapter in the export. */
  addMarker(label?: string): void;
  /** How many markers this take has, for the UI. */
  markerCount: number;
}

export function useRecorder(): RecorderControls {
  const recorderRef = useRef<MultiTrackRecorder | null>(null);
  const [state, setState] = useState<RecordingState>('idle');
  const [segmentCount, setSegmentCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastRecordingDir, setLastRecordingDir] = useState<string | null>(null);
  const [markerCount, setMarkerCount] = useState(0);

  const startedAt = useRef(0);
  const pausedAt = useRef(0);
  const pausedAccumMs = useRef(0);
  const setRecordingActive = useAppStore((s) => s.setRecordingActive);

  useEffect(() => {
    if (state !== 'recording') return undefined;
    const id = window.setInterval(() => {
      setElapsedMs(performance.now() - startedAt.current - pausedAccumMs.current);
    }, 200);
    return () => window.clearInterval(id);
  }, [state]);

  // Publish a global "recording in progress" flag so the shell can lock
  // navigation — switching tabs mid-recording would unmount this hook and orphan
  // the take. Balanced: registers while non-idle, deregisters on idle/unmount.
  useEffect(() => {
    if (state === 'idle') return undefined;
    setRecordingActive(true);
    return () => setRecordingActive(false);
  }, [state, setRecordingActive]);

  // Safety net: if this view is ever torn down while a recorder is live (window
  // close, forced unmount), finalize it so segments are sealed rather than left
  // writing frozen frames to disk with no UI to stop them.
  useEffect(
    () => () => {
      void recorderRef.current?.stop();
      recorderRef.current = null;
    },
    [],
  );

  const start = useCallback(
    async (
      configs: TrackConfig[],
      targetFps: number,
      providedStreams?: Record<string, MediaStream>,
      options?: RecorderOptions,
    ) => {
      // Guard against a double-start (rapid clicks, or start during an in-flight
      // stop): a second recorder would overwrite the ref and orphan the first.
      if (recorderRef.current) return false;
      setError(null);
      setSegmentCount(0);
      setElapsedMs(0);
      setLastRecordingDir(null);
      setMarkerCount(0);
      const recorder = new MultiTrackRecorder({
        onSegmentCount: (n) => setSegmentCount(n),
        onError: (message) => setError(message),
      });
      recorderRef.current = recorder;
      startedAt.current = performance.now();
      pausedAccumMs.current = 0;
      try {
        await recorder.start(configs, targetFps, providedStreams, options);
      } catch (err) {
        // Only report on the take that is still current; one already cancelled
        // by stop or unmount has nothing left to tell the user.
        if (recorderRef.current === recorder) {
          setError(err instanceof Error ? err.message : 'Could not start recording');
          recorderRef.current = null;
          setState('idle');
        } else {
          // Cancelled mid-start and then failed: release whatever it acquired.
          await recorder.stop().catch(() => undefined);
        }
        return false;
      }
      // Starting takes seconds (the screen picker, waiting for first frames).
      // A stop — the panic hotkey, or this view unmounting — that landed in
      // that window has already let go of this recorder. Marking it
      // 'recording' now would leave a live capture with nothing able to stop
      // it, so finish the cancellation instead.
      if (recorderRef.current !== recorder) {
        await recorder.stop().catch(() => undefined);
        return false;
      }
      setState('recording');
      return true;
    },
    [],
  );

  const pause = useCallback(async () => {
    await recorderRef.current?.pause();
    pausedAt.current = performance.now();
    setState('paused');
  }, []);

  const resume = useCallback(async () => {
    pausedAccumMs.current += performance.now() - pausedAt.current;
    await recorderRef.current?.resume();
    setState('recording');
  }, []);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    try {
      const result = await recorder?.stop();
      if (result) setLastRecordingDir(result.dir);
    } catch (err) {
      // Even if finalize reports an error, the UI must return to idle — the
      // sealed segments are already durable on disk and recoverable.
      setError(err instanceof Error ? err.message : 'Stop encountered an error');
    } finally {
      setState('idle');
    }
  }, []);

  const setMicMuted = useCallback((muted: boolean) => {
    recorderRef.current?.setMicMuted(muted);
  }, []);

  const setZoomed = useCallback((zoomed: boolean) => {
    recorderRef.current?.setZoomed(zoomed);
  }, []);

  const snapshot = useCallback(async (): Promise<string | null> => {
    const blob = await (recorderRef.current?.snapshot() ?? Promise.resolve(null));
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { path } = await window.novarec.saveSnapshot({ bytes });
    return path;
  }, []);

  /**
   * Bookmark the current moment. Timed from the same clock the segment
   * durations use, so the marker lands where the user actually pressed it —
   * and written through to disk immediately rather than held here, so it
   * survives a crash exactly as the footage does.
   */
  const addMarker = useCallback((label?: string) => {
    const recorder = recorderRef.current;
    const recordingId = recorder?.id;
    if (!recorder || !recordingId) return;
    // The recorder's own clock: the one the segments are timed by, and the one
    // that leaves out a pause still in progress.
    const atMs = recorder.elapsedMs();
    setMarkerCount((n) => n + 1);
    void window.novarec
      .addMarker({
        recordingId,
        marker: {
          id: crypto.randomUUID(),
          atMs,
          label: label ?? '',
          color: '#3b82f6',
        },
      })
      .catch(() => undefined);
  }, []);

  return {
    state,
    elapsedMs,
    segmentCount,
    error,
    lastRecordingDir,
    start,
    pause,
    resume,
    stop,
    setMicMuted,
    setZoomed,
    snapshot,
    addMarker,
    markerCount,
  };
}
