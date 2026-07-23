import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { EXPORT_PRESETS, type TrackConfig } from '@novarec/shared';
import { useMediaDevices, useSources } from '../record/useCaptureData.js';
import { useRecorder } from '../record/useRecorder.js';
import { useAppSettings } from '../settings/useAppSettings.js';
import { useExportStore } from '../../exportStore.js';
import { Compositor } from './Compositor.js';
import { useSceneMedia } from './useSceneMedia.js';
import { clampSource, defaultSource, type SceneSource, type SceneSourceKind } from './scene.js';

function presetSettings(id: string) {
  return (EXPORT_PRESETS.find((p) => p.id === id) ?? EXPORT_PRESETS[0]!).settings;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function StudioView(): ReactElement {
  const [previewSources, setPreviewSources] = useState<SceneSource[]>([]);
  const [programSources, setProgramSources] = useState<SceneSource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(false);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const programCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const autoExportedDir = useRef<string | null>(null);

  const recorder = useRecorder();
  const exportJob = useExportStore();
  const appSettings = useAppSettings();
  const devices = useMediaDevices();
  const sourceList = useSources();
  const cameras = (devices.data ?? []).filter((d) => d.kind === 'camera');
  const screens = sourceList.data?.screens ?? [];

  // One shared media pool feeds both canvases (a camera is opened only once).
  const getMedia = useSceneMedia([...previewSources, ...programSources]);

  const selected = previewSources.find((s) => s.id === selectedId) ?? null;
  const recording = recorder.state !== 'idle';

  // Auto-export the scene recording when it stops, if enabled in Settings.
  useEffect(() => {
    const dir = recorder.lastRecordingDir;
    if (
      recorder.state === 'idle' &&
      dir &&
      appSettings.data?.autoExportOnStop &&
      autoExportedDir.current !== dir
    ) {
      autoExportedDir.current = dir;
      exportJob.start(dir, presetSettings(appSettings.data?.exportPreset ?? 'youtube'));
    }
  }, [recorder.state, recorder.lastRecordingDir, appSettings.data, exportJob]);

  function addSource(kind: SceneSourceKind): void {
    const id = crypto.randomUUID();
    const src = defaultSource(kind, id);
    if (kind === 'camera' && cameras[0]) src.deviceId = cameras[0].deviceId ?? null;
    if (kind === 'screen' && screens[0]) src.screenSourceId = screens[0].id;
    setPreviewSources((prev) => [...prev, src]);
    setSelectedId(id);
  }

  function updateSource(id: string, patch: Partial<SceneSource>): void {
    setPreviewSources((prev) =>
      prev.map((s) => (s.id === id ? clampSource({ ...s, ...patch }) : s)),
    );
  }

  function removeSource(id: string): void {
    setPreviewSources((prev) => prev.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function move(id: string, dir: -1 | 1): void {
    setPreviewSources((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(i, 1);
      if (item) next.splice(j, 0, item);
      return next;
    });
  }

  function transition(): void {
    // Push the edited preview to the live program output.
    setProgramSources(previewSources.map((s) => ({ ...s })));
  }

  function onImageFile(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const id = crypto.randomUUID();
      setPreviewSources((prev) => [
        ...prev,
        { ...defaultSource('image', id), dataUrl: String(reader.result), name: file.name },
      ]);
      setSelectedId(id);
    };
    reader.readAsDataURL(file);
  }

  function toggleRecord(): void {
    if (recording) {
      void recorder.stop();
      return;
    }
    const canvas = programCanvasRef.current;
    if (!canvas || programSources.length === 0) return;
    const stream = canvas.captureStream(30);
    const configs: TrackConfig[] = [
      { id: 'screen', kind: 'screen', label: 'Program', enabled: true, gain: 1, monitor: false },
    ];
    if (micOn) {
      configs.push({
        id: 'microphone',
        kind: 'microphone',
        label: 'Microphone',
        enabled: true,
        gain: 1,
        monitor: false,
      });
    }
    void recorder.start(configs, 30, { screen: stream });
  }

  return (
    <section className="flex h-full flex-col overflow-auto p-6">
      <header className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-app">Studio</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Compose your scene</h1>
        </div>
        <div className="flex items-center gap-2">
          {recording && (
            <span className="flex items-center gap-2 text-sm text-app2">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" aria-hidden />
              {formatElapsed(recorder.elapsedMs)}
            </span>
          )}
          <label className="flex items-center gap-2 text-sm text-app2">
            <input
              type="checkbox"
              checked={micOn}
              disabled={recording}
              onChange={(e) => setMicOn(e.target.checked)}
              className="accent-blue-500"
            />
            Mic
          </label>
          <button
            type="button"
            disabled={programSources.length === 0}
            onClick={toggleRecord}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-muted-app ${
              recording ? 'bg-neutral-700 hover:bg-neutral-600' : 'bg-red-600 hover:bg-red-500'
            }`}
          >
            {recording ? 'Stop' : 'Record program'}
          </button>
        </div>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-app">Add to preview:</span>
        <AddButton onClick={() => addSource('screen')}>Screen</AddButton>
        <AddButton onClick={() => addSource('camera')}>Camera</AddButton>
        <AddButton onClick={() => fileRef.current?.click()}>Image</AddButton>
        <AddButton onClick={() => addSource('text')}>Text</AddButton>
        {recorder.state === 'idle' && recorder.lastRecordingDir && (
          <button
            type="button"
            onClick={() =>
              recorder.lastRecordingDir &&
              exportJob.start(
                recorder.lastRecordingDir,
                presetSettings(appSettings.data?.exportPreset ?? 'youtube'),
              )
            }
            className="ml-auto rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
          >
            Export last scene
          </button>
        )}
      </div>

      {/* Preview (editable) and Program (live output) — OBS-style Studio Mode. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <CanvasPane label="Preview" hint="Arrange here" tone="preview">
          <Compositor
            sources={previewSources}
            selectedId={selectedId}
            getMedia={getMedia}
            canvasRef={previewCanvasRef}
            interactive
            onSelect={setSelectedId}
            onUpdate={updateSource}
          />
        </CanvasPane>
        <CanvasPane label="Program" hint={recording ? 'Recording' : 'Live'} tone="program">
          <Compositor
            sources={programSources}
            selectedId={null}
            getMedia={getMedia}
            canvasRef={programCanvasRef}
            interactive={false}
          />
        </CanvasPane>
      </div>

      <div className="my-4 flex items-center justify-center">
        <button
          type="button"
          disabled={previewSources.length === 0}
          onClick={transition}
          className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition enabled:hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-muted-app"
        >
          Transition to Program →
        </button>
      </div>

      <p className="mb-4 text-center text-xs text-muted-app">
        Drag to move, drag the blue corner to resize. Edit in Preview, then Transition to send it
        live to Program — the Program output is what records. Stay on this tab while recording.
      </p>
      {recorder.error && <p className="mb-4 text-center text-xs text-red-400">{recorder.error}</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <SourcesPanel
          sources={previewSources}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRemove={removeSource}
          onToggle={(id, v) => updateSource(id, { visible: v })}
          onMove={move}
        />
        {selected && (
          <PropertiesPanel
            source={selected}
            cameras={cameras.map((c) => ({ id: c.deviceId ?? c.id, label: c.label }))}
            screens={screens.map((s) => ({ id: s.id, label: s.name }))}
            onUpdate={(patch) => updateSource(selected.id, patch)}
          />
        )}
      </div>

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onImageFile} />
    </section>
  );
}

function CanvasPane({
  label,
  hint,
  tone,
  children,
}: {
  label: string;
  hint: string;
  tone: 'preview' | 'program';
  children: ReactElement;
}): ReactElement {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-app">
          {label}
        </span>
        <span
          className={`text-xs font-medium ${tone === 'program' ? 'text-red-400' : 'text-blue-400'}`}
        >
          {hint}
        </span>
      </div>
      {children}
    </div>
  );
}

function AddButton({ children, onClick }: { children: string; onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg bg-surface2 px-3 py-1.5 text-sm font-medium text-app2 transition hover:text-app"
    >
      + {children}
    </button>
  );
}

function SourcesPanel({
  sources,
  selectedId,
  onSelect,
  onRemove,
  onToggle,
  onMove,
}: {
  sources: SceneSource[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string, visible: boolean) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}): ReactElement {
  return (
    <div className="rounded-2xl border border-app bg-surface p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-app">
        Preview sources ({sources.length})
      </h2>
      {sources.length === 0 ? (
        <p className="text-sm text-muted-app">Add a screen, camera, image, or text to begin.</p>
      ) : (
        <ul className="space-y-1">
          {[...sources].reverse().map((s) => (
            <li
              key={s.id}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                s.id === selectedId ? 'bg-blue-500/15 ring-1 ring-inset ring-blue-500/40' : ''
              }`}
            >
              <button
                type="button"
                title={s.visible ? 'Hide' : 'Show'}
                onClick={() => onToggle(s.id, !s.visible)}
                className="text-sm text-app2"
              >
                {s.visible ? '👁' : '🚫'}
              </button>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className="min-w-0 flex-1 truncate text-left text-sm text-app2 hover:text-app"
              >
                {s.name}
              </button>
              <button
                type="button"
                title="Bring forward"
                onClick={() => onMove(s.id, 1)}
                className="text-xs text-muted-app hover:text-app2"
              >
                ▲
              </button>
              <button
                type="button"
                title="Send backward"
                onClick={() => onMove(s.id, -1)}
                className="text-xs text-muted-app hover:text-app2"
              >
                ▼
              </button>
              <button
                type="button"
                title="Remove"
                onClick={() => onRemove(s.id)}
                className="text-xs text-red-400 hover:text-red-300"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PropertiesPanel({
  source,
  cameras,
  screens,
  onUpdate,
}: {
  source: SceneSource;
  cameras: { id: string; label: string }[];
  screens: { id: string; label: string }[];
  onUpdate: (patch: Partial<SceneSource>) => void;
}): ReactElement {
  return (
    <div className="rounded-2xl border border-app bg-surface p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-app">
        {source.name}
      </h2>
      <div className="space-y-3 text-sm">
        {source.kind === 'camera' && (
          <Field label="Device">
            <select
              value={source.deviceId ?? ''}
              onChange={(e) => onUpdate({ deviceId: e.target.value || null })}
              className="w-full rounded-md bg-surface2 px-2 py-1.5 text-xs text-app2"
            >
              <option value="">Default camera</option>
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {source.kind === 'screen' && (
          <Field label="Screen">
            <select
              value={source.screenSourceId ?? ''}
              onChange={(e) => onUpdate({ screenSourceId: e.target.value || null })}
              className="w-full rounded-md bg-surface2 px-2 py-1.5 text-xs text-app2"
            >
              <option value="">Select a screen…</option>
              {screens.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {source.kind === 'text' && (
          <>
            <Field label="Text">
              <input
                value={source.text}
                onChange={(e) => onUpdate({ text: e.target.value })}
                className="w-full rounded-md bg-surface2 px-2 py-1.5 text-xs text-app"
              />
            </Field>
            <div className="flex gap-2">
              <Field label="Color">
                <input
                  type="color"
                  value={source.color}
                  onChange={(e) => onUpdate({ color: e.target.value })}
                  className="h-8 w-full rounded bg-surface2"
                />
              </Field>
              <Field label="Size">
                <input
                  type="number"
                  value={source.fontSize}
                  min={16}
                  max={400}
                  onChange={(e) => onUpdate({ fontSize: Number(e.target.value) })}
                  className="w-full rounded-md bg-surface2 px-2 py-1.5 text-xs text-app"
                />
              </Field>
            </div>
          </>
        )}
        <div className="grid grid-cols-2 gap-2">
          <NumField label="X" value={source.x} onChange={(v) => onUpdate({ x: v })} />
          <NumField label="Y" value={source.y} onChange={(v) => onUpdate({ y: v })} />
          <NumField label="Width" value={source.width} onChange={(v) => onUpdate({ width: v })} />
          <NumField
            label="Height"
            value={source.height}
            onChange={(v) => onUpdate({ height: v })}
          />
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-app">{label}</span>
      {children}
    </label>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}): ReactElement {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-app">{label}</span>
      <input
        type="number"
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-md bg-surface2 px-2 py-1.5 text-xs text-app"
      />
    </label>
  );
}
