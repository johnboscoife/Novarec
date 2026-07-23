import type { ReactElement, ReactNode } from 'react';
import {
  DEFAULT_HOTKEYS,
  humanizeAccelerator,
  type AppSettings,
  type HotkeyAction,
  type Theme,
} from '@novarec/shared';
import { useAppInfo } from '../shell/useAppInfo.js';
import { useAppSettings, useSaveAppSettings } from './useAppSettings.js';

const ACTION_LABELS: Record<HotkeyAction, string> = {
  startStop: 'Start / stop recording',
  pauseResume: 'Pause / resume',
  marker: 'Drop a marker',
  annotateToggle: 'Toggle annotation',
  cursorZoomNow: 'Cursor zoom now',
  muteMic: 'Mute microphone',
  panicStop: 'Panic stop',
};

export function SettingsView(): ReactElement {
  const settings = useAppSettings();
  const save = useSaveAppSettings();
  const info = useAppInfo();
  const platform = info.data?.platform ?? 'win32';
  const current = settings.data;

  function update(patch: Partial<AppSettings>): void {
    if (current) save.mutate({ ...current, ...patch });
  }

  if (!current) {
    return <section className="p-8 text-muted-app">Loading settings…</section>;
  }

  return (
    <section className="flex h-full flex-col overflow-auto p-8">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-app">Settings</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Preferences</h1>
      </header>

      <div className="max-w-2xl space-y-6">
        <Panel title="Appearance">
          <Row label="Theme" hint="Choose the app appearance.">
            <select
              value={current.theme}
              onChange={(e) => update({ theme: e.target.value as Theme })}
              className="rounded-md bg-surface2 px-3 py-1.5 text-sm text-app"
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </Row>
          <ToggleRow
            label="Reduced motion"
            hint="Disable animations and transitions."
            checked={current.reducedMotion}
            onChange={(v) => update({ reducedMotion: v })}
          />
        </Panel>

        <Panel title="Recording">
          <ToggleRow
            label="Auto-export when I stop"
            hint="As soon as a recording stops, produce a shareable MP4 (YouTube 1080p) and reveal it — no extra click."
            checked={current.autoExportOnStop}
            onChange={(v) => update({ autoExportOnStop: v })}
          />
        </Panel>

        <Panel title="Privacy">
          <ToggleRow
            label="Anonymous usage telemetry"
            hint="Off by default. When on, only anonymous, non-identifying usage events are sent — never file names, paths, or content."
            checked={current.telemetryOptIn}
            onChange={(v) => update({ telemetryOptIn: v })}
          />
          <ToggleRow
            label="Vault mode — encrypt media at rest"
            hint="Encrypt recorded media on disk."
            checked={current.vaultMode}
            onChange={(v) => update({ vaultMode: v })}
          />
        </Panel>

        <Panel title="Storage">
          <Row label="Location" hint="Where recordings are stored.">
            <span className="text-sm text-muted-app">
              {current.storageLocation ?? 'Default (app data folder)'}
            </span>
          </Row>
        </Panel>

        <Panel title="Global shortcuts">
          <ul className="space-y-1.5 text-sm">
            {DEFAULT_HOTKEYS.map((binding) => (
              <li key={binding.action} className="flex items-center justify-between">
                <span className="text-app2">{ACTION_LABELS[binding.action]}</span>
                <kbd className="rounded bg-surface2 px-2 py-0.5 text-xs text-app2">
                  {humanizeAccelerator(binding.accelerator, platform)}
                </kbd>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </section>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <div className="rounded-xl border border-app bg-surface p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-app">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm text-app2">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-muted-app">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string | undefined;
  checked: boolean;
  onChange: (value: boolean) => void;
}): ReactElement {
  return (
    <Row label={label} hint={hint}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-blue-600' : 'bg-surface2'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}
        />
      </button>
    </Row>
  );
}
