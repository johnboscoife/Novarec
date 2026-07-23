import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { sustainVerdict, type SustainVerdict } from '@novarec/capture';
import {
  SUPPORTED_TARGET_FPS,
  countdownSequence,
  type CaptureSource,
  type HotkeyAction,
  type SavedRegion,
  type TargetFps,
  type TrackConfig,
  type WebcamShape,
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
import { useAppSettings } from '../settings/useAppSettings.js';
import { useExportStore } from '../../exportStore.js';

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
  const [webcamShape, setWebcamShape] = useState<WebcamShape>('circle');
  const [webcamSize, setWebcamSize] = useState(240);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Export is an app-wide background job (keeps running across view switches).
  const exportJob = useExportStore();

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
      // If a screen is selected, hand main the DIP bounds of its backing display
      // so it can drive motion on THAT display (not NovaRec's own). Windows have
      // no display bounds — the in-window bar covers those.
      const screenSource = screens.find((s) => s.id === selectedSourceId);
      const display = screenSource
        ? displays.data?.find((d) => d.id === screenSource.displayId)
        : undefined;
      const motionBounds = display ? display.bounds : null;
      setProbe(await runSustainProbe(selectedSourceId, targetFps, motionBounds));
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : 'Capture probe failed');
    } finally {
      setProbing(false);
    }
  }

  const recorder = useRecorder();
  const info = useAppInfo();
  const appSettings = useAppSettings();
  const autoExportedDir = useRef<string | null>(null);
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
    // The camera is NOT a separate recorded track: it's the floating overlay
    // window, captured into the screen recording in place. Nothing to add here.
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

  // The floating camera is baked into the screen recording, so it isn't a
  // standalone track — recording needs a screen/window or an audio source.
  const canRecord = selectedSourceId !== null || micOn || systemAudioOn;

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

  function exportLastRecording(): void {
    if (recorder.lastRecordingDir) exportJob.start(recorder.lastRecordingDir);
  }

  // View-scoped mirror of the app-wide export job for the "Last recording" card.
  const jobForThis = exportJob.dir === recorder.lastRecordingDir ? exportJob : null;
  const exporting = jobForThis?.status === 'running';
  const exportProgress = exporting ? jobForThis.progress : null;
  const exportedPath = jobForThis?.status === 'done' ? jobForThis.outputPath : null;
  const exportError = jobForThis?.status === 'error' ? jobForThis.error : null;

  // Auto-export when a recording stops, if enabled in Settings. A ref holds the
  // latest closure so the effect can depend only on the stop transition, and
  // `autoExportedDir` guards against exporting the same recording twice.
  const maybeAutoExport = useRef<(dir: string) => void>(() => undefined);
  maybeAutoExport.current = (dir) => {
    if (
      appSettings.data?.autoExportOnStop &&
      autoExportedDir.current !== dir &&
      exportJob.status !== 'running'
    ) {
      autoExportedDir.current = dir;
      exportJob.start(dir);
    }
  };
  useEffect(() => {
    if (recorder.state === 'idle' && recorder.lastRecordingDir) {
      maybeAutoExport.current(recorder.lastRecordingDir);
    }
  }, [recorder.state, recorder.lastRecordingDir]);

  // The floating webcam is a separate always-on-top window captured into the
  // recording — so it appears in the export exactly where/size/shape it sits.
  useEffect(() => {
    if (cameraOn) {
      void window.novarec.showWebcam({
        deviceId: cameraDeviceId,
        shape: webcamShape,
        sizePx: webcamSize,
      });
    } else {
      void window.novarec.hideWebcam();
    }
  }, [cameraOn, cameraDeviceId, webcamShape, webcamSize]);

  // Always tear the overlay down when leaving Record.
  useEffect(() => () => void window.novarec.hideWebcam(), []);

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

      <div className="grid flex-1 gap-4 overflow-auto lg:grid-cols-[1.5fr_1fr]">
        {/* Capture setup — one compact card */}
        <div className="rounded-2xl border border-app bg-surface p-5">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-app">
            What to capture
          </label>
          <div className="flex gap-2">
            <select
              value={selectedSourceId ?? ''}
              onChange={(e) => setSelectedSourceId(e.target.value || null)}
              className="min-w-0 flex-1 rounded-lg bg-surface2 px-3 py-2.5 text-sm text-app"
            >
              <option value="">Select a screen or window…</option>
              {screens.length > 0 && (
                <optgroup label="Screens">
                  {screens.map((s) => {
                    const d = displays.data?.find((x) => x.id === s.displayId);
                    return (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {d
                          ? ` — ${d.bounds.width}×${d.bounds.height}${d.primary ? ' · primary' : ''}`
                          : ''}
                      </option>
                    );
                  })}
                </optgroup>
              )}
              {windows.length > 0 && (
                <optgroup label="Windows">
                  {windows.slice(0, 60).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name || 'Untitled window'}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button
              type="button"
              onClick={region ? clearRegion : selectRegion}
              className={`shrink-0 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                region
                  ? 'bg-blue-600/20 text-blue-300 ring-1 ring-inset ring-blue-500/40'
                  : 'bg-surface2 text-app2 hover:bg-surface2'
              }`}
            >
              {region ? 'Region ✓' : 'Region…'}
            </button>
          </div>
          {region && (
            <p className="mt-2 text-xs text-muted-app">
              {Math.round(region.rect.width)}×{Math.round(region.rect.height)} at (
              {Math.round(region.rect.x)}, {Math.round(region.rect.y)})
              {region.displayId === null ? ' · spans monitors' : ''} ·{' '}
              <button
                type="button"
                onClick={selectRegion}
                className="text-blue-300 hover:underline"
              >
                re-select
              </button>
            </p>
          )}

          <label className="mb-1.5 mt-5 block text-xs font-semibold uppercase tracking-wider text-muted-app">
            Also include
          </label>
          <div className="flex flex-wrap gap-2">
            <TrackChip label="Camera" active={cameraOn} onClick={() => toggleCamera(!cameraOn)} />
            <TrackChip label="Microphone" active={micOn} onClick={() => toggleMic(!micOn)} />
            <TrackChip
              label="System audio"
              hint="Windows"
              active={systemAudioOn}
              onClick={() => setSystemAudioOn(!systemAudioOn)}
            />
          </div>
          {(cameraOn || micOn) && (
            <div className="mt-3 space-y-2">
              {cameraOn && (
                <DeviceSelect
                  label="Camera"
                  devices={videoDevices}
                  value={cameraDeviceId}
                  onChange={setCameraDeviceId}
                />
              )}
              {micOn && (
                <DeviceSelect
                  label="Microphone"
                  devices={audioDevices}
                  value={micDeviceId}
                  onChange={setMicDeviceId}
                />
              )}
            </div>
          )}

          <label className="mb-1.5 mt-5 block text-xs font-semibold uppercase tracking-wider text-muted-app">
            Frame rate
          </label>
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
          <p className="mt-3 text-xs text-muted-app">
            Each track is saved separately and stays in sync until you export.
          </p>
        </div>

        {/* Camera preview + capacity check */}
        <div className="space-y-4">
          {cameraOn && (
            <div className="rounded-2xl border border-app bg-surface p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-app">
                Floating camera
              </h2>
              <p className="mt-2 text-xs text-muted-app">
                A live webcam window floats on your screen — drag it anywhere; it&apos;s recorded in
                place. Shape and size apply live, even while recording.
              </p>

              <div className="mt-3 flex gap-2">
                {(['circle', 'rounded', 'square'] as const).map((shape) => (
                  <button
                    key={shape}
                    type="button"
                    onClick={() => setWebcamShape(shape)}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium capitalize transition ${
                      webcamShape === shape
                        ? 'bg-blue-600 text-white'
                        : 'bg-surface2 text-app2 hover:bg-surface2'
                    }`}
                  >
                    {shape}
                  </button>
                ))}
              </div>

              <label className="mt-4 block">
                <span className="mb-1 flex items-center justify-between text-xs text-muted-app">
                  <span>Size</span>
                  <span>{webcamSize}px</span>
                </span>
                <input
                  type="range"
                  min={140}
                  max={520}
                  step={10}
                  value={webcamSize}
                  onChange={(e) => setWebcamSize(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
              </label>
            </div>
          )}

          <div className="rounded-2xl border border-app bg-surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-app">
                Capacity check
              </h2>
              {probe && (
                <span className={VERDICT_STYLE[sustainVerdict(probe.metrics, targetFps)].className}>
                  {VERDICT_STYLE[sustainVerdict(probe.metrics, targetFps)].label}
                </span>
              )}
            </div>
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
                  : 'Select a source first'}
            </button>

            {probeError && <p className="mt-3 text-sm text-red-400">{probeError}</p>}

            {probe && (
              <div className="mt-4 space-y-1 text-sm">
                <Metric label="Delivered">{probe.metrics.deliveredFps.toFixed(1)} fps</Metric>
                <Metric label="Dropped">{(probe.metrics.droppedRatio * 100).toFixed(1)}%</Metric>
                <Metric label="Jitter">{probe.metrics.jitterMs.toFixed(1)} ms</Metric>
                <Metric label="Can sustain">
                  <span className="font-semibold text-app">
                    {probe.maxSustainableFps > 0
                      ? `${probe.maxSustainableFps} fps`
                      : 'Below 24 fps'}
                  </span>
                </Metric>

                {probe.maxSustainableFps > 0 && probe.maxSustainableFps < targetFps && (
                  <button
                    type="button"
                    onClick={() => chooseFps(probe.maxSustainableFps as TargetFps)}
                    className="mt-2 w-full rounded-lg bg-blue-600/15 px-3 py-2 text-sm font-medium text-blue-300 ring-1 ring-inset ring-blue-500/40 transition hover:bg-blue-600/25"
                  >
                    Switch to {probe.maxSustainableFps} fps for a smooth capture
                  </button>
                )}
              </div>
            )}

            <p className="mt-3 text-xs text-muted-app">
              Animates the screen for 3s to measure true capacity — a still screen isn&apos;t a real
              result.
            </p>
          </div>
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

function Metric({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-app">{label}</span>
      <span className="text-app2">{children}</span>
    </div>
  );
}

function TrackChip({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint?: string | undefined;
  active: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
        active ? 'bg-blue-600 text-white' : 'bg-surface2 text-app2 hover:bg-surface2'
      }`}
    >
      {label}
      {hint && (
        <span className={`ml-1.5 text-xs ${active ? 'text-blue-100' : 'text-muted-app'}`}>
          ({hint})
        </span>
      )}
    </button>
  );
}

function DeviceSelect({
  label,
  devices,
  value,
  onChange,
}: {
  label: string;
  devices: CaptureSource[];
  value: string | null;
  onChange: (id: string) => void;
}): ReactElement {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-app">
      <span className="w-20 shrink-0">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 truncate rounded-md bg-surface2 px-2 py-1.5 text-xs text-app2"
      >
        <option value="">Default device</option>
        {devices.map((d) => (
          <option key={d.id} value={d.deviceId ?? d.id}>
            {d.label}
          </option>
        ))}
      </select>
    </label>
  );
}
