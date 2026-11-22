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
  zoomed: false,
  zoomAvailable: false,
};

export function ControlsOverlay(): ReactElement {
  const [st, setSt] = useState<RecordControlState>(INITIAL);
  // The hovered button's label, shown INSIDE the pill. Native `title` tooltips
  // are separate OS windows that content protection doesn't cover, so they
  // showed up floating in recordings.
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return window.novarec.onControlsState(setSt);
  }, []);

  const send = (action: ControlAction): void => void window.novarec.sendControlCommand({ action });

  const paused = st.state === 'paused';
  const dotClass = paused ? 'bg-amber-400' : 'animate-pulse bg-red-500';

  const button = (label: string): { label: string; onHint: (h: string | null) => void } => ({
    label,
    onHint: setHint,
  });

  return (
    <div className="wc-drag flex h-screen w-screen flex-col justify-center rounded-2xl border border-white/10 bg-neutral-900/95 px-3 text-white shadow-2xl">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />
        <span className="w-14 shrink-0 font-mono text-sm tabular-nums">
          {formatElapsed(st.elapsedMs)}
        </span>

        {/* A zoomed capture is otherwise invisible while recording — the screen
          looks normal, and only the file is zoomed. */}
        {st.zoomed && (
          <span className="shrink-0 rounded-md bg-blue-500/25 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-blue-200 ring-1 ring-inset ring-blue-400/40">
            ZOOM
          </span>
        )}

        <div className="wc-nodrag flex items-center gap-1">
          <PillButton
            {...button(paused ? 'Resume' : 'Pause')}
            onClick={() => send(paused ? 'resume' : 'pause')}
          >
            {paused ? '▶' : '⏸'}
          </PillButton>
          <PillButton {...button('Stop')} tone="danger" onClick={() => send('stop')}>
            ⏹
          </PillButton>
          {st.micAvailable && (
            <PillButton
              {...button(st.micMuted ? 'Unmute mic' : 'Mute mic')}
              active={st.micMuted}
              onClick={() => send('muteMic')}
            >
              {st.micMuted ? '🔇' : '🎤'}
            </PillButton>
          )}
          {st.zoomAvailable && (
            <PillButton
              {...button(st.zoomed ? 'Zoom out' : 'Zoom to cursor')}
              active={st.zoomed}
              onClick={() => send('toggleZoom')}
            >
              {st.zoomed ? '🔎' : '🔍'}
            </PillButton>
          )}
          <PillButton {...button('Save a snapshot of the screen')} onClick={() => send('snapshot')}>
            📷
          </PillButton>
          {/* Was 📷, which reads as "take a photo" — someone reaching for a
            snapshot toggled their webcam off mid-recording instead. */}
          <PillButton
            {...button(st.webcamOn ? 'Turn camera off' : 'Turn camera on')}
            active={!st.webcamOn}
            onClick={() => send('toggleWebcam')}
          >
            {st.webcamOn ? '🎥' : '🚷'}
          </PillButton>
        </div>

        <div className="wc-nodrag ml-auto">
          <PillButton {...button('Dismiss')} onClick={() => send('dismiss')}>
            ✕
          </PillButton>
        </div>
      </div>
      <p
        className="mt-0.5 h-3.5 truncate text-center text-[10px] leading-none text-white/70"
        aria-hidden
      >
        {hint ?? ''}
      </p>
    </div>
  );
}

function PillButton({
  children,
  label,
  onHint,
  onClick,
  active = false,
  tone = 'default',
}: {
  children: ReactElement | string;
  label: string;
  onHint: (hint: string | null) => void;
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
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => onHint(label)}
      onMouseLeave={() => onHint(null)}
      onFocus={() => onHint(label)}
      onBlur={() => onHint(null)}
      className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm transition ${base}`}
    >
      {children}
    </button>
  );
}
