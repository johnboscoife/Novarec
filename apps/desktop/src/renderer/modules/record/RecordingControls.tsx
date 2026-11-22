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
  /** The capture is zoomed toward the pointer right now. */
  zoomed?: boolean;
  zoomShortcut?: string;
  /**
   * Nothing visual is selected, so a take would contain sound only. Said up
   * front: an audio-only file that looks like a finished video is a nasty
   * surprise after a long take.
   */
  audioOnly?: boolean;
}

export function RecordingControls({
  recorder,
  canStart,
  onStart,
  zoomed = false,
  zoomShortcut,
  audioOnly = false,
}: RecordingControlsProps): ReactElement {
  const { state, elapsedMs, segmentCount, error, markerCount } = recorder;
  const active = state !== 'idle';
  const statusLabel =
    state === 'idle' ? 'Not recording' : state === 'paused' ? 'Paused' : 'Recording';

  return (
    <div className="rounded-xl border border-app bg-surface p-4">
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
            <span className="font-mono text-sm text-app2">{formatElapsed(elapsedMs)}</span>
          )}
          {active && zoomed && (
            // Recording zoomed is invisible from the app window otherwise, and
            // it is baked into the file.
            <span
              className="rounded-md bg-blue-600/20 px-2 py-0.5 text-xs font-medium text-blue-300 ring-1 ring-inset ring-blue-500/40"
              title={zoomShortcut ? `Press ${zoomShortcut} to zoom out` : undefined}
            >
              Zoomed
            </span>
          )}
          {active && (
            <span className="text-xs text-muted-app">
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
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition enabled:hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-muted-app"
            >
              Record
            </button>
          )}
          {active && (
            // Discoverable alongside the global shortcut: a feature reachable
            // only by a key combination is a feature most people never find.
            <button
              type="button"
              onClick={() => recorder.addMarker()}
              title="Mark this moment (Ctrl+Shift+M) — becomes a chapter in the export"
              className="rounded-lg bg-surface2 px-3 py-2 text-sm text-app2 transition hover:text-app"
            >
              Mark
              {markerCount > 0 && (
                <span className="ml-1.5 text-xs text-blue-300">{markerCount}</span>
              )}
            </button>
          )}
          {state === 'recording' && (
            <>
              <button
                type="button"
                onClick={() => void recorder.pause()}
                className="rounded-lg bg-surface2 px-4 py-2 text-sm text-app2 hover:bg-surface2"
              >
                Pause
              </button>
              <button
                type="button"
                onClick={() => void recorder.stop()}
                className="rounded-lg bg-surface2 px-4 py-2 text-sm font-medium text-app hover:bg-surface2"
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
                className="rounded-lg bg-surface2 px-4 py-2 text-sm font-medium text-app hover:bg-surface2"
              >
                Stop
              </button>
            </>
          )}
        </div>
      </div>

      {state === 'idle' && audioOnly && (
        <p role="note" className="mt-3 text-sm text-amber-300">
          No screen or window is selected, so this will record audio only. Choose one under “What to
          capture” to record video.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
