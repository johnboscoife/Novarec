import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrackConfig } from '@novarec/shared';
import { useAppStore } from '../../store.js';
import { MultiTrackRecorder } from './recorder.js';

export type RecordingState = 'idle' | 'recording' | 'paused';

export interface RecorderControls {
  state: RecordingState;
  elapsedMs: number;
  segmentCount: number;
  error: string | null;
  lastRecordingDir: string | null;
  start(
    configs: TrackConfig[],
    targetFps: number,
    providedStreams?: Record<string, MediaStream>,
  ): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  setMicMuted(muted: boolean): void;
}

export function useRecorder(): RecorderControls {
  const recorderRef = useRef<MultiTrackRecorder | null>(null);
  const [state, setState] = useState<RecordingState>('idle');
  const [segmentCount, setSegmentCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastRecordingDir, setLastRecordingDir] = useState<string | null>(null);

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
    ) => {
      // Guard against a double-start (rapid clicks, or start during an in-flight
      // stop): a second recorder would overwrite the ref and orphan the first.
      if (recorderRef.current) return;
      setError(null);
      setSegmentCount(0);
      setElapsedMs(0);
      setLastRecordingDir(null);
      const recorder = new MultiTrackRecorder({
        onSegmentCount: (n) => setSegmentCount(n),
        onError: (message) => setError(message),
      });
      recorderRef.current = recorder;
      startedAt.current = performance.now();
      pausedAccumMs.current = 0;
      try {
        await recorder.start(configs, targetFps, providedStreams);
        setState('recording');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start recording');
        recorderRef.current = null;
        setState('idle');
      }
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
  };
}
