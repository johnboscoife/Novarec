import { useEffect, useState, type ReactElement } from 'react';
import type { ControlAction, RecordControlState } from '@novarec/shared';

/**
 * The floating recording control (loaded with `?overlay=controls`). A small
 * draggable pill with the recording essentials. Buttons opt out of the drag
 * region so they stay clickable. It reflects state pushed from the main window
 * and sends commands back the same way.
 */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

const INITIAL: RecordControlState = {
  state: 'recording',
  elapsedMs: 0,
  micMuted: false,
  micAvailable: false,
  webcamOn: false,
};

export function ControlsOverlay(): ReactElement {
  const [st, setSt] = useState<RecordControlState>(INITIAL);

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return window.novarec.onControlsState(setSt);
  }, []);

  const send = (action: ControlAction): void => void window.novarec.sendControlCommand({ action });

  const paused = st.state === 'paused';
  const dotClass = paused ? 'bg-amber-400' : 'animate-pulse bg-red-500';

  return (
    <div className="wc-drag flex h-screen w-screen items-center gap-2 rounded-2xl border border-white/10 bg-neutral-900/95 px-3 text-white shadow-2xl">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />
      <span className="w-14 shrink-0 font-mono text-sm tabular-nums">
        {formatElapsed(st.elapsedMs)}
      </span>

      <div className="wc-nodrag flex items-center gap-1">
        <PillButton
          label={paused ? 'Resume' : 'Pause'}
          onClick={() => send(paused ? 'resume' : 'pause')}
        >
          {paused ? '▶' : '⏸'}
        </PillButton>
        <PillButton label="Stop" tone="danger" onClick={() => send('stop')}>
          ⏹
        </PillButton>
        {st.micAvailable && (
          <PillButton
            label={st.micMuted ? 'Unmute mic' : 'Mute mic'}
            active={st.micMuted}
            onClick={() => send('muteMic')}
          >
            {st.micMuted ? '🔇' : '🎤'}
          </PillButton>
        )}
        <PillButton
          label={st.webcamOn ? 'Hide webcam' : 'Show webcam'}
          active={!st.webcamOn}
          onClick={() => send('toggleWebcam')}
        >
          {st.webcamOn ? '📷' : '🚫'}
        </PillButton>
      </div>

      <div className="wc-nodrag ml-auto">
        <PillButton label="Dismiss" onClick={() => send('dismiss')}>
          ✕
        </PillButton>
      </div>
    </div>
  );
}

function PillButton({
  children,
  label,
  onClick,
  active = false,
  tone = 'default',
}: {
  children: ReactElement | string;
  label: string;
  onClick: () => void;
  active?: boolean;
  tone?: 'default' | 'danger';
}): ReactElement {
  const base =
    tone === 'danger'
      ? 'bg-red-600 hover:bg-red-500'
      : active
        ? 'bg-blue-600 hover:bg-blue-500'
        : 'bg-white/10 hover:bg-white/20';
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm transition ${base}`}
    >
      {children}
    </button>
  );
}
