import { memo, type ReactElement } from 'react';
import { useMicLevel } from './useMicLevel.js';

/**
 * Input level meter for the selected microphone.
 *
 * Segmented rather than a smooth bar because the useful question is "am I in the
 * right range?", not "what exactly is the number": green through most of the
 * scale, amber where it's getting hot, red where it will clip. A held peak marks
 * transients the smoothed bar rounds off.
 */
const SEGMENTS = 24;
/** Segment index at which the colour changes (of SEGMENTS). */
const AMBER_FROM = 17;
const RED_FROM = 21;

function segmentClass(index: number, lit: boolean): string {
  if (!lit) return 'bg-surface2';
  if (index >= RED_FROM) return 'bg-red-500';
  if (index >= AMBER_FROM) return 'bg-amber-400';
  return 'bg-emerald-500';
}

interface MicMeterProps {
  deviceId: string | null;
  enabled: boolean;
  muted?: boolean;
}

export const MicMeter = memo(function MicMeter({
  deviceId,
  enabled,
  muted = false,
}: MicMeterProps): ReactElement {
  const { level, peak, error } = useMicLevel(deviceId, enabled);
  const litCount = Math.round(level * SEGMENTS);
  const peakIndex = peak > 0 ? Math.min(SEGMENTS - 1, Math.round(peak * SEGMENTS) - 1) : -1;

  if (error) {
    return (
      <p className="text-xs text-red-400">
        Microphone unavailable — {error}. Pick another input above.
      </p>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-muted-app">Level</span>
      <div
        className="flex h-2.5 min-w-0 flex-1 gap-px overflow-hidden rounded"
        role="meter"
        aria-label="Microphone input level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
      >
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={`h-full flex-1 first:rounded-l last:rounded-r ${
              muted ? 'bg-surface2' : segmentClass(i, i < litCount || i === peakIndex)
            }`}
          />
        ))}
      </div>
      <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-muted-app">
        {muted ? 'Muted' : level > 0.02 ? 'Hearing you' : 'Silent'}
      </span>
    </div>
  );
});
