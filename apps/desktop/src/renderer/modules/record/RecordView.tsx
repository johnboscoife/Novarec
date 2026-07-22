import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { sustainVerdict, type SustainVerdict } from '@novarec/capture';
import { SUPPORTED_TARGET_FPS, type SavedRegion, type TargetFps } from '@novarec/shared';
import { useAppInfo } from '../shell/useAppInfo.js';
import {
  useCaptureSettings,
  useDisplays,
  useMediaDevices,
  useSaveCaptureSettings,
  useSources,
} from './useCaptureData.js';
import { runSustainProbe, type ProbeResult } from './probe.js';
import { useRecorder } from './useRecorder.js';
import { RecordingControls } from './RecordingControls.js';
import { RecoveryBanner } from './RecoveryBanner.js';

const VERDICT_STYLE: Record<SustainVerdict, { label: string; className: string }> = {
  sustained: { label: 'Sustained', className: 'text-emerald-400' },
  marginal: { label: 'Marginal', className: 'text-amber-400' },
  dropped: { label: 'Dropping frames', className: 'text-red-400' },
};

export function RecordView(): ReactElement {
  const displays = useDisplays();
  const sources = useSources();
  const devices = useMediaDevices();
  const settings = useCaptureSettings();
  const save = useSaveCaptureSettings();

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [targetFps, setTargetFps] = useState<TargetFps>(30);
  const [region, setRegion] = useState<SavedRegion | null>(null);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  // Seed local state from persisted settings once loaded.
  useEffect(() => {
    if (settings.data) {
      setTargetFps(settings.data.targetFps);
      setRegion(settings.data.region);
    }
  }, [settings.data]);

  function persist(next: { targetFps?: TargetFps; region?: SavedRegion | null }): void {
    save.mutate({
      targetFps: next.targetFps ?? targetFps,
      region: next.region === undefined ? region : next.region,
      resolution: null,
    });
  }

  function chooseFps(fps: TargetFps): void {
    setTargetFps(fps);
    setProbe(null);
    persist({ targetFps: fps });
  }

  async function selectRegion(): Promise<void> {
    const picked = await window.novarec.beginRegionSelect();
    if (picked) {
      setRegion(picked);
      persist({ region: picked });
    }
  }

  function clearRegion(): void {
    setRegion(null);
    persist({ region: null });
  }

  async function runProbe(): Promise<void> {
    if (!selectedSourceId) return;
    setProbing(true);
    setProbeError(null);
    try {
      setProbe(await runSustainProbe(selectedSourceId, targetFps));
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : 'Capture probe failed');
    } finally {
      setProbing(false);
    }
  }

  const recorder = useRecorder();
  const info = useAppInfo();
  const screens = sources.data?.screens ?? [];
  const windows = sources.data?.windows ?? [];

  return (
    <section className="flex h-full flex-col p-8">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">Record</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Set up your capture</h1>
      </header>

      <RecoveryBanner />

      <div className="mb-6">
        <RecordingControls
          recorder={recorder}
          canStart={selectedSourceId !== null && recorder.state === 'idle'}
          onStart={() => {
            if (selectedSourceId) void recorder.start(selectedSourceId, targetFps);
          }}
        />
      </div>

      <div className="grid flex-1 grid-cols-[1.3fr_1fr] gap-6 overflow-hidden">
        {/* Sources */}
        <div className="flex flex-col gap-4 overflow-auto pr-1">
          <SourceGroup title={`Screens (${screens.length})`} loading={sources.isLoading}>
            {screens.map((s) => {
              const d = displays.data?.find((x) => x.id === s.displayId);
              return (
                <SourceRow
                  key={s.id}
                  label={s.name}
                  detail={
                    d
                      ? `${d.bounds.width}×${d.bounds.height} · ${d.scaleFactor}× DPI${d.primary ? ' · primary' : ''}`
                      : undefined
                  }
                  selected={selectedSourceId === s.id}
                  onSelect={() => setSelectedSourceId(s.id)}
                />
              );
            })}
          </SourceGroup>

          <SourceGroup title={`Windows (${windows.length})`} loading={sources.isLoading}>
            {windows.slice(0, 40).map((w) => (
              <SourceRow
                key={w.id}
                label={w.name || 'Untitled window'}
                selected={selectedSourceId === w.id}
                onSelect={() => setSelectedSourceId(w.id)}
              />
            ))}
          </SourceGroup>

          <SourceGroup title={`Devices (${devices.data?.length ?? 0})`} loading={devices.isLoading}>
            {(devices.data ?? []).map((d) => (
              <SourceRow
                key={d.id}
                label={d.label}
                detail={d.kind}
                onSelect={() => undefined}
                selected={false}
                muted
              />
            ))}
          </SourceGroup>
        </div>

        {/* Settings */}
        <div className="flex flex-col gap-5 overflow-auto">
          <Panel title="Frame rate">
            <div className="flex gap-2">
              {SUPPORTED_TARGET_FPS.map((fps) => (
                <button
                  key={fps}
                  type="button"
                  onClick={() => chooseFps(fps)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    targetFps === fps
                      ? 'bg-blue-600 text-white'
                      : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                  }`}
                >
                  {fps}
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Region">
            {region ? (
              <div className="flex items-center justify-between">
                <div className="text-sm text-neutral-300">
                  {Math.round(region.rect.width)} × {Math.round(region.rect.height)}
                  <span className="ml-2 text-xs text-neutral-500">
                    at ({Math.round(region.rect.x)}, {Math.round(region.rect.y)})
                    {region.displayId === null ? ' · spans monitors' : ''}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectRegion}
                    className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700"
                  >
                    Re-select
                  </button>
                  <button
                    type="button"
                    onClick={clearRegion}
                    className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-700"
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={selectRegion}
                className="w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700"
              >
                Select a region…
              </button>
            )}
          </Panel>

          <Panel title="Capacity check">
            <button
              type="button"
              disabled={!selectedSourceId || probing}
              onClick={runProbe}
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition enabled:hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
            >
              {probing
                ? 'Probing (3s)…'
                : selectedSourceId
                  ? `Test ${targetFps} fps on this source`
                  : 'Select a screen or window first'}
            </button>

            {probeError && <p className="mt-3 text-sm text-red-400">{probeError}</p>}

            {probe && (
              <div className="mt-4 space-y-1 text-sm">
                <Metric label="Verdict">
                  <span
                    className={VERDICT_STYLE[sustainVerdict(probe.metrics, targetFps)].className}
                  >
                    {VERDICT_STYLE[sustainVerdict(probe.metrics, targetFps)].label}
                  </span>
                </Metric>
                <Metric label="Delivered">{probe.metrics.deliveredFps.toFixed(1)} fps</Metric>
                <Metric label="Dropped">{(probe.metrics.droppedRatio * 100).toFixed(1)}%</Metric>
                <Metric label="Jitter">{probe.metrics.jitterMs.toFixed(1)} ms</Metric>
                <Metric label="This machine can sustain">
                  <span className="font-semibold text-neutral-100">
                    {probe.maxSustainableFps > 0 ? `${probe.maxSustainableFps} fps` : '—'}
                  </span>
                </Metric>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <footer className="mt-6 flex items-center gap-2 text-xs text-neutral-600">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
        {info.data
          ? `${info.data.name} ${info.data.version} · ${displays.data?.length ?? 0} display(s) · ${info.data.platform}`
          : 'Connecting…'}
      </footer>
    </section>
  );
}

function SourceGroup({
  title,
  loading,
  children,
}: {
  title: string;
  loading: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {title}
      </h2>
      {loading ? (
        <p className="text-sm text-neutral-600">Enumerating…</p>
      ) : (
        <div className="space-y-1.5">{children}</div>
      )}
    </div>
  );
}

function SourceRow({
  label,
  detail,
  selected,
  onSelect,
  muted = false,
}: {
  label: string;
  detail?: string | undefined;
  selected: boolean;
  onSelect: () => void;
  muted?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={muted}
      className={`w-full rounded-lg border px-3 py-2 text-left transition ${
        selected
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-neutral-800 bg-neutral-900/40 hover:border-neutral-700'
      } ${muted ? 'cursor-default opacity-70' : ''}`}
    >
      <div className="truncate text-sm text-neutral-200">{label}</div>
      {detail && <div className="truncate text-xs text-neutral-500">{detail}</div>}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Metric({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-200">{children}</span>
    </div>
  );
}
