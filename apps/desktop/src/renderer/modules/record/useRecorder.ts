import { useCallback, useEffect, useRef, useState } from 'react';
import { StreamRecorder } from './recorder.js';

export type RecordingState = 'idle' | 'recording' | 'paused';

export interface RecorderControls {
  state: RecordingState;
  elapsedMs: number;
  segmentCount: number;
  error: string | null;
  start(sourceId: string, targetFps: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}

export function useRecorder(): RecorderControls {
  const recorderRef = useRef<StreamRecorder | null>(null);
  const [state, setState] = useState<RecordingState>('idle');
  const [segmentCount, setSegmentCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

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

  const start = useCallback(async (sourceId: string, targetFps: number) => {
    setError(null);
    setSegmentCount(0);
    setElapsedMs(0);
    const recorder = new StreamRecorder({
      onSegmentCount: (n) => setSegmentCount(n),
      onError: (message) => setError(message),
    });
    recorderRef.current = recorder;
    startedAt.current = performance.now();
    pausedAccumMs.current = 0;
    await recorder.start(sourceId, targetFps);
    setState('recording');
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
    await recorderRef.current?.stop();
    recorderRef.current = null;
    setState('idle');
  }, []);

  return { state, elapsedMs, segmentCount, error, start, pause, resume, stop };
}
