import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrackConfig } from '@novarec/shared';
import { MultiTrackRecorder } from './recorder.js';

export type RecordingState = 'idle' | 'recording' | 'paused';

export interface RecorderControls {
  state: RecordingState;
  elapsedMs: number;
  segmentCount: number;
  error: string | null;
  lastRecordingDir: string | null;
  start(configs: TrackConfig[], targetFps: number): Promise<void>;
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

  useEffect(() => {
    if (state !== 'recording') return undefined;
    const id = window.setInterval(() => {
      setElapsedMs(performance.now() - startedAt.current - pausedAccumMs.current);
    }, 200);
    return () => window.clearInterval(id);
  }, [state]);

  const start = useCallback(async (configs: TrackConfig[], targetFps: number) => {
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
      await recorder.start(configs, targetFps);
      setState('recording');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start recording');
      recorderRef.current = null;
      setState('idle');
    }
  }, []);

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
    const result = await recorderRef.current?.stop();
    recorderRef.current = null;
    setState('idle');
    if (result) setLastRecordingDir(result.dir);
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
