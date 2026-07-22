import type { ReactElement } from 'react';
import type { RecorderControls } from './useRecorder.js';

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

interface RecordingControlsProps {
  recorder: RecorderControls;
  canStart: boolean;
  onStart: () => void;
}

export function RecordingControls({
  recorder,
  canStart,
  onStart,
}: RecordingControlsProps): ReactElement {
  const { state, elapsedMs, segmentCount, error } = recorder;
  const active = state !== 'idle';
  const statusLabel =
    state === 'idle' ? 'Not recording' : state === 'paused' ? 'Paused' : 'Recording';

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Always-visible recording indicator — cannot be disabled (security rule). */}
          <span
            className={`inline-flex h-3 w-3 rounded-full ${
              state === 'recording'
                ? 'animate-pulse bg-red-500'
                : state === 'paused'
                  ? 'bg-amber-400'
                  : 'bg-neutral-600'
            }`}
            aria-hidden
          />
          <span className="text-sm font-medium">{statusLabel}</span>
          {active && (
            <span className="font-mono text-sm text-neutral-300">{formatElapsed(elapsedMs)}</span>
          )}
          {active && (
            <span className="text-xs text-neutral-500">
              {segmentCount} segment{segmentCount === 1 ? '' : 's'} saved
            </span>
          )}
        </div>

        <div className="flex gap-2">
          {state === 'idle' && (
            <button
              type="button"
              disabled={!canStart}
              onClick={onStart}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition enabled:hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
            >
              Record
            </button>
          )}
          {state === 'recording' && (
            <>
              <button
                type="button"
                onClick={() => void recorder.pause()}
                className="rounded-lg bg-neutral-800 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-700"
              >
                Pause
              </button>
              <button
                type="button"
                onClick={() => void recorder.stop()}
                className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
              >
                Stop
              </button>
            </>
          )}
          {state === 'paused' && (
            <>
              <button
                type="button"
                onClick={() => void recorder.resume()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={() => void recorder.stop()}
                className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
              >
                Stop
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
