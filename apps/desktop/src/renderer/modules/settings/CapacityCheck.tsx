import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { sustainVerdict, type SustainVerdict } from '@novarec/capture';
import { SUPPORTED_TARGET_FPS, type TargetFps } from '@novarec/shared';
import {
  useCaptureSettings,
  useDisplays,
  useSaveCaptureSettings,
  useSources,
} from '../record/useCaptureData.js';
import { runSustainProbe, type ProbeResult } from '../record/probe.js';

/**
 * The capacity check: a 3-second capture probe that reports what frame rate this
 * machine can actually sustain, and writes the answer straight into the capture
 * settings Record reads.
 *
 * It lives in Settings rather than on the Record page because it is a one-off
 * diagnostic about the machine, not a per-take decision — and because it drives
 * on-screen motion for three seconds, which has no place in the middle of
 * setting up a recording.
 */
const VERDICT_STYLE: Record<SustainVerdict, { label: string; className: string }> = {
  sustained: { label: 'Sustained', className: 'text-emerald-400' },
  marginal: { label: 'Marginal', className: 'text-amber-400' },
  dropped: { label: 'Dropping frames', className: 'text-red-400' },
};

export function CapacityCheck(): ReactElement {
  const sources = useSources();
  const displays = useDisplays();
  const settings = useCaptureSettings();
  const saveSettings = useSaveCaptureSettings();

  const [sourceId, setSourceId] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const screens = sources.data?.screens ?? [];
  const targetFps = settings.data?.targetFps ?? 30;

  // Default to the primary screen — the one most recordings are of.
  useEffect(() => {
    if (sourceId !== null || screens.length === 0) return;
    const primary = displays.data?.find((d) => d.primary);
    const match = primary ? screens.find((s) => s.displayId === primary.id) : undefined;
    setSourceId((match ?? screens[0])?.id ?? null);
  }, [sourceId, screens, displays.data]);

  async function run(): Promise<void> {
    if (!sourceId) return;
    setProbing(true);
    setError(null);
    try {
      // Hand main the DIP bounds of the probed display so it drives motion on
      // THAT screen — screen capture is change-driven, and a still screen would
      // read as 0 fps on a perfectly capable machine.
      const screen = screens.find((s) => s.id === sourceId);
      const display = screen ? displays.data?.find((d) => d.id === screen.displayId) : undefined;
      setProbe(await runSustainProbe(sourceId, targetFps, display ? display.bounds : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture probe failed');
    } finally {
      setProbing(false);
    }
  }

  function applyFps(fps: TargetFps): void {
    if (!settings.data) return;
    saveSettings.mutate({ ...settings.data, targetFps: fps });
    setProbe(null);
  }

  const recommended = probe?.maxSustainableFps ?? 0;
  const canApply =
    recommended > 0 &&
    recommended !== targetFps &&
    (SUPPORTED_TARGET_FPS as readonly number[]).includes(recommended);

  return (
    <div className="rounded-xl border border-app bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-app">
          Performance
        </h2>
        {probe && (
          <span
            className={`text-xs font-medium ${VERDICT_STYLE[sustainVerdict(probe.metrics, targetFps)].className}`}
          >
            {VERDICT_STYLE[sustainVerdict(probe.metrics, targetFps)].label}
          </span>
        )}
      </div>

      <p className="text-xs leading-relaxed text-muted-app">
        Measures what frame rate this machine can really sustain while capturing. It animates the
        chosen screen for 3 seconds — a still screen would report a false result — and the answer
        becomes your recording frame rate.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={sourceId ?? ''}
          onChange={(e) => {
            setSourceId(e.target.value || null);
            setProbe(null);
          }}
          aria-label="Screen to test"
          disabled={probing}
          className="min-w-0 flex-1 rounded-md bg-surface2 px-3 py-2 text-sm text-app disabled:opacity-60"
        >
          {screens.length === 0 && <option value="">No screen available</option>}
          {screens.map((s) => {
            const d = displays.data?.find((x) => x.id === s.displayId);
            return (
              <option key={s.id} value={s.id}>
                {s.name}
                {d ? ` — ${d.bounds.width}×${d.bounds.height}${d.primary ? ' · primary' : ''}` : ''}
              </option>
            );
          })}
        </select>
        <button
          type="button"
          disabled={!sourceId || probing}
          onClick={() => void run()}
          className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition enabled:hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-muted-app"
        >
          {probing ? 'Testing (3s)…' : `Test ${targetFps} fps`}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {probe && (
        <div className="mt-4 space-y-1 text-sm">
          <Metric label="Delivered">{probe.metrics.deliveredFps.toFixed(1)} fps</Metric>
          <Metric label="Dropped">{(probe.metrics.droppedRatio * 100).toFixed(1)}%</Metric>
          <Metric label="Jitter">{probe.metrics.jitterMs.toFixed(1)} ms</Metric>
          <Metric label="Can sustain">
            <span className="font-semibold text-app">
              {recommended > 0 ? `${recommended} fps` : 'Below 24 fps'}
            </span>
          </Metric>

          {canApply && (
            <button
              type="button"
              onClick={() => applyFps(recommended as TargetFps)}
              className="mt-2 w-full rounded-lg bg-blue-600/15 px-3 py-2 text-sm font-medium text-blue-300 ring-1 ring-inset ring-blue-500/40 transition hover:bg-blue-600/25"
            >
              Use {recommended} fps for recordings
            </button>
          )}
          {recommended > 0 && recommended === targetFps && (
            <p className="mt-2 text-xs text-emerald-400">
              Your recording frame rate ({targetFps} fps) is what this machine can hold ✓
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-app">{label}</span>
      <span className="text-app2">{children}</span>
    </div>
  );
}
