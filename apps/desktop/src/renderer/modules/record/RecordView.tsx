import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { sustainVerdict, type SustainVerdict } from '@novarec/capture';
import {
  EXPORT_PRESETS,
  SUPPORTED_TARGET_FPS,
  countdownSequence,
  type CaptureSource,
  type HotkeyAction,
  type SavedRegion,
  type TargetFps,
  type TrackConfig,
} from '@novarec/shared';
import { useAppInfo } from '../shell/useAppInfo.js';
import {
  useCaptureSettings,
  useDisplays,
  useMediaDevices,
  usePrimeDevices,
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

  // Additional tracks captured alongside the screen (kept separate until export).
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [systemAudioOn, setSystemAudioOn] = useState(false);
  const [cameraDeviceId, setCameraDeviceId] = useState<string | null>(null);
  const [micDeviceId, setMicDeviceId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<number | null>(null);

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
  const videoDevices = (devices.data ?? []).filter((d) => d.kind === 'camera');
  const audioDevices = (devices.data ?? []).filter((d) => d.kind === 'microphone');
  const primeDevices = usePrimeDevices();

  // Enabling a track unlocks real device names (Blue Yeti vs. "Microphone").
  function toggleCamera(on: boolean): void {
    setCameraOn(on);
    if (on) void primeDevices({ video: true });
  }
  function toggleMic(on: boolean): void {
    setMicOn(on);
    if (on) void primeDevices({ audio: true });
  }

  function buildTrackConfigs(): TrackConfig[] {
    const configs: TrackConfig[] = [];
    if (selectedSourceId) {
      configs.push({
        id: 'screen',
        kind: 'screen',
        label: 'Screen',
        sourceId: selectedSourceId,
        enabled: true,
        gain: 1,
        monitor: false,
      });
    }
    if (cameraOn) {
      configs.push({
        id: 'camera',
        kind: 'camera',
        label: 'Camera',
        enabled: true,
        gain: 1,
        monitor: false,
        ...(cameraDeviceId ? { deviceId: cameraDeviceId } : {}),
      });
    }
    if (micOn) {
      configs.push({
        id: 'microphone',
        kind: 'microphone',
        label: 'Microphone',
        enabled: true,
        gain: 1,
        monitor: false,
        ...(micDeviceId ? { deviceId: micDeviceId } : {}),
      });
    }
    if (systemAudioOn) {
      configs.push({
        id: 'systemAudio',
        kind: 'systemAudio',
        label: 'System audio',
        enabled: true,
        gain: 1,
        monitor: false,
      });
    }
    return configs;
  }

  const canRecord = selectedSourceId !== null || cameraOn || micOn || systemAudioOn;

  function beginRecording(): void {
    if (!canRecord || recorder.state !== 'idle' || countdown !== null) return;
    const sequence = countdownSequence(3);
    const configs = buildTrackConfigs();
    if (sequence.length === 0) {
      void recorder.start(configs, targetFps);
      return;
    }
    let index = 0;
    setCountdown(sequence[0] ?? null);
    const timer = window.setInterval(() => {
      index += 1;
      if (index >= sequence.length) {
        window.clearInterval(timer);
        setCountdown(null);
        void recorder.start(configs, targetFps);
      } else {
        setCountdown(sequence[index] ?? null);
      }
    }, 1000);
  }

  async function exportLastRecording(): Promise<void> {
    const dir = recorder.lastRecordingDir;
    const youtube = EXPORT_PRESETS.find((p) => p.id === 'youtube');
    if (!dir || !youtube) return;
    setExporting(true);
    setExportError(null);
    setExportedPath(null);
    setExportProgress(0);
    const off = window.novarec.onExportProgress(({ elapsedMs, totalMs }) => {
      setExportProgress(totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 0);
    });
    try {
      const { outputPath } = await window.novarec.runExport({
        recordingDir: dir,
        settings: youtube.settings,
      });
      setExportedPath(outputPath);
      await window.novarec.revealPath({ path: outputPath });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      off();
      setExporting(false);
      setExportProgress(null);
    }
  }

  // Global hotkeys drive the recording lifecycle even when the app is unfocused.
  const hotkeyHandler = useRef<(action: HotkeyAction) => void>(() => undefined);
  hotkeyHandler.current = (action) => {
    if (action === 'startStop') {
      if (recorder.state === 'idle') beginRecording();
      else void recorder.stop();
    } else if (action === 'pauseResume') {
      if (recorder.state === 'recording') void recorder.pause();
      else if (recorder.state === 'paused') void recorder.resume();
    } else if (action === 'panicStop') {
      void recorder.stop();
    }
  };
  useEffect(() => window.novarec.onHotkey((action) => hotkeyHandler.current(action)), []);

  return (
    <section className="relative flex h-full flex-col p-8">
      {countdown !== null && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70">
          <span className="text-8xl font-semibold tabular-nums text-white">{countdown}</span>
        </div>
      )}

      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-app">Record</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Set up your capture</h1>
      </header>

      <RecoveryBanner />

      <div className="mb-6">
        <RecordingControls
          recorder={recorder}
          canStart={canRecord && recorder.state === 'idle' && countdown === null}
          onStart={beginRecording}
        />
      </div>

      {recorder.state === 'idle' && recorder.lastRecordingDir && (
        <div className="mb-6 rounded-xl border border-app bg-surface p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Last recording ready</p>
              <p className="truncate text-xs text-muted-app">
                {exportedPath ?? recorder.lastRecordingDir}
              </p>
            </div>
            <button
              type="button"
              disabled={exporting}
              onClick={() => void exportLastRecording()}
              className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition enabled:hover:bg-blue-500 disabled:opacity-60"
            >
              {exporting
                ? 'Exporting…'
                : exportedPath
                  ? 'Exported ✓ · Export again'
                  : 'Export (YouTube 1080p)'}
            </button>
          </div>
          {exporting && exportProgress !== null && (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface2">
              <div
                className="h-full bg-blue-500 transition-[width]"
                style={{ width: `${Math.round(exportProgress * 100)}%` }}
              />
            </div>
          )}
          {exportError && <p className="mt-2 text-sm text-red-400">{exportError}</p>}
        </div>
      )}

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
                      : 'bg-surface2 text-app2 hover:bg-surface2'
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
                <div className="text-sm text-app2">
                  {Math.round(region.rect.width)} × {Math.round(region.rect.height)}
                  <span className="ml-2 text-xs text-muted-app">
                    at ({Math.round(region.rect.x)}, {Math.round(region.rect.y)})
                    {region.displayId === null ? ' · spans monitors' : ''}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectRegion}
                    className="rounded-md bg-surface2 px-3 py-1.5 text-xs text-app2 hover:bg-surface2"
                  >
                    Re-select
                  </button>
                  <button
                    type="button"
                    onClick={clearRegion}
                    className="rounded-md bg-surface2 px-3 py-1.5 text-xs text-muted-app hover:bg-surface2"
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={selectRegion}
                className="w-full rounded-lg bg-surface2 px-3 py-2 text-sm text-app2 hover:bg-surface2"
              >
                Select a region…
              </button>
            )}
          </Panel>

          <Panel title="Tracks">
            <div className="space-y-2">
              <TrackToggle
                label="Camera"
                checked={cameraOn}
                onToggle={toggleCamera}
                devices={videoDevices}
                deviceId={cameraDeviceId}
                onDevice={setCameraDeviceId}
              />
              <TrackToggle
                label="Microphone"
                checked={micOn}
                onToggle={toggleMic}
                devices={audioDevices}
                deviceId={micDeviceId}
                onDevice={setMicDeviceId}
              />
              <label className="flex items-center gap-2 text-sm text-app2">
                <input
                  type="checkbox"
                  checked={systemAudioOn}
                  onChange={(e) => setSystemAudioOn(e.target.checked)}
                  className="accent-blue-500"
                />
                System audio <span className="text-xs text-muted-app">(Windows)</span>
              </label>
            </div>
            <p className="mt-2 text-xs text-muted-app">
              Screen comes from the selected source. Each track is saved separately and stays in
              sync.
            </p>
          </Panel>

          <Panel title="Capacity check">
            <button
              type="button"
              disabled={!selectedSourceId || probing}
              onClick={runProbe}
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition enabled:hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-muted-app"
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
                  <span className="font-semibold text-app">
                    {probe.maxSustainableFps > 0
                      ? `${probe.maxSustainableFps} fps`
                      : 'Below 24 fps'}
                  </span>
                </Metric>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <footer className="mt-6 flex items-center gap-2 text-xs text-dim-app">
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
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-app">
        {title}
      </h2>
      {loading ? (
        <p className="text-sm text-dim-app">Enumerating…</p>
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
        selected ? 'border-blue-500 bg-blue-500/10' : 'border-app bg-surface hover:border-app'
      } ${muted ? 'cursor-default opacity-70' : ''}`}
    >
      <div className="truncate text-sm text-app2">{label}</div>
      {detail && <div className="truncate text-xs text-muted-app">{detail}</div>}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <div className="rounded-xl border border-app bg-surface p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-app">
        {title}
      </h2>
      {children}
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

function TrackToggle({
  label,
  checked,
  onToggle,
  devices,
  deviceId,
  onDevice,
}: {
  label: string;
  checked: boolean;
  onToggle: (value: boolean) => void;
  devices: CaptureSource[];
  deviceId: string | null;
  onDevice: (id: string) => void;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="flex items-center gap-2 text-sm text-app2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          className="accent-blue-500"
        />
        {label}
      </label>
      {checked && devices.length > 0 && (
        <select
          value={deviceId ?? ''}
          onChange={(e) => onDevice(e.target.value)}
          className="max-w-[55%] truncate rounded-md bg-surface2 px-2 py-1 text-xs text-app2"
        >
          <option value="">Default</option>
          {devices.map((d) => (
            <option key={d.id} value={d.deviceId ?? d.id}>
              {d.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
