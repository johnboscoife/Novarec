import { memo, type ReactElement } from 'react';
import type { RecordingState } from './useRecorder.js';

/**
 * The Record banner: brand art, a one-line promise, and a live read-out of what
 * this take will actually capture. It sits in the narrow right-hand column
 * alongside the setup card, so the layout is vertical and the type scales down.
 *
 * Presentational only — every control lives in the cards beside it — so it can
 * be memoized and never re-renders on the recording timer tick.
 */
export interface HeroSummary {
  sourceLabel: string | null;
  regionLabel: string | null;
  extras: string[];
  fps: number;
}

interface RecordHeroProps {
  state: RecordingState;
  summary: HeroSummary;
}

const STATE_COPY: Record<RecordingState, { dot: string; label: string }> = {
  idle: { dot: 'bg-white/60', label: 'Ready' },
  recording: { dot: 'bg-red-400 animate-pulse', label: 'Recording' },
  paused: { dot: 'bg-amber-300', label: 'Paused' },
};

export const RecordHero = memo(function RecordHero({
  state,
  summary,
}: RecordHeroProps): ReactElement {
  const status = STATE_COPY[state];
  const chips = [
    summary.sourceLabel ?? 'No source selected',
    ...(summary.regionLabel ? [summary.regionLabel] : []),
    ...summary.extras,
    `${summary.fps} fps`,
  ];

  return (
    <div className="relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-sky-500 p-5 text-white shadow-lg shadow-blue-950/25">
      <HeroArt />

      <div className="relative">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-white/90 ring-1 ring-inset ring-white/25">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${status.dot}`} aria-hidden />
          {status.label}
        </span>

        <h2 className="mt-3 text-xl font-semibold leading-snug tracking-tight">
          Capture the whole screen — or just the part that matters.
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-white/80">
          Every source is recorded as its own track and sealed to disk as you go, so nothing drifts
          and a crash costs you a second — not the take.
        </p>

        <div className="mt-4 border-t border-white/20 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/70">
            This take
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Capture summary">
            {chips.map((chip) => (
              <li
                key={chip}
                className="rounded-lg bg-white/12 px-2.5 py-1 text-[11px] font-medium text-white/90 ring-1 ring-inset ring-white/20 backdrop-blur-sm"
              >
                {chip}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
});

/**
 * Decorative backdrop: a capture aperture and an audio waveform, echoing the two
 * halves of a take. Inline SVG so it ships in the bundle with no asset request
 * and scales cleanly on any DPI.
 */
function HeroArt(): ReactElement {
  return (
    <svg
      className="pointer-events-none absolute -right-12 -top-12 h-[200px] w-[240px] opacity-[0.16]"
      viewBox="0 0 240 200"
      fill="none"
      aria-hidden
    >
      <circle cx="168" cy="70" r="86" stroke="white" strokeWidth="1.5" />
      <circle cx="168" cy="70" r="60" stroke="white" strokeWidth="1.5" />
      <circle cx="168" cy="70" r="34" stroke="white" strokeWidth="1.5" />
      <circle cx="168" cy="70" r="11" fill="white" />
      {/* Waveform: fixed bar heights keep the art identical between renders. */}
      {[
        [16, 24],
        [32, 54],
        [48, 90],
        [64, 40],
        [80, 112],
        [96, 64],
        [112, 30],
      ].map(([x, h]) => (
        <rect
          key={x}
          x={x}
          y={162 - (h ?? 0) / 2}
          width="6"
          height={h}
          rx="3"
          fill="white"
          opacity="0.85"
        />
      ))}
    </svg>
  );
}
