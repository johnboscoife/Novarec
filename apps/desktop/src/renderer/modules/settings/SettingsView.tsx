import { useState, type ReactElement, type ReactNode } from 'react';
import {
  DEFAULT_HOTKEYS,
  humanizeAccelerator,
  type AppSettings,
  type HotkeyAction,
  type Theme,
} from '@novarec/shared';
import { useAppInfo } from '../shell/useAppInfo.js';
import { useAppSettings, useSaveAppSettings } from './useAppSettings.js';
import { GOOGLE_MEET_ENABLED } from '../../featureFlags.js';
import { CapacityCheck } from './CapacityCheck.js';

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
            hint="As soon as a recording stops, produce a shareable 1080p MP4 and reveal it — no extra click."
            checked={current.autoExportOnStop}
            onChange={(v) => update({ autoExportOnStop: v })}
          />
          <ToggleRow
            label="Remember my setup"
            hint="Restore the last capture source, tracks, webcam shape/size and frame rate when NovaRec reopens."
            checked={current.retainSetup}
            onChange={(v) => update({ retainSetup: v })}
          />
          <ToggleRow
            label="Confirm before quitting"
            hint="Ask for confirmation when you close NovaRec (always asks while a recording is in progress)."
            checked={current.confirmOnExit}
            onChange={(v) => update({ confirmOnExit: v })}
          />
        </Panel>

        <CapacityCheck />

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
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm text-app2">Recordings location</div>
              <div className="mt-0.5 truncate text-xs leading-relaxed text-muted-app">
                {current.storageLocation ?? 'Default — the app data folder'}
              </div>
              <div className="mt-0.5 text-xs text-dim-app">
                New recordings go here; existing ones stay where they were.
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              {current.storageLocation && (
                <button
                  type="button"
                  onClick={() => update({ storageLocation: null })}
                  className="rounded-lg bg-surface2 px-3 py-2 text-sm text-muted-app transition hover:text-app2"
                >
                  Reset
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  void window.novarec
                    .chooseExportFolder({ defaultPath: current.storageLocation })
                    .then(({ path }) => {
                      if (path) update({ storageLocation: path });
                    })
                }
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
              >
                Change…
              </button>
            </div>
          </div>
        </Panel>

        {GOOGLE_MEET_ENABLED && <GoogleAccountPanel current={current} onSave={update} />}

        <MeetingsPanel current={current} onSave={update} />

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

        <LegalPanel />
      </div>
    </section>
  );
}

/** Where the canonical legal documents live (the repository is public). */
const DOCS_BASE = 'https://github.com/johnboscoife/Novarec/blob/master';
const LEGAL_LINKS: readonly { label: string; url: string }[] = [
  { label: 'Terms of Use', url: `${DOCS_BASE}/docs/TERMS.md` },
  { label: 'Privacy Policy', url: `${DOCS_BASE}/docs/PRIVACY.md` },
  { label: 'Licence (MIT)', url: `${DOCS_BASE}/LICENSE` },
  { label: 'Third-party notices', url: `${DOCS_BASE}/docs/THIRD-PARTY-NOTICES.md` },
];

/**
 * Publisher and the documents the installer made the user accept, reachable
 * again after install — someone who agreed to terms must be able to re-read them.
 */
function LegalPanel(): ReactElement {
  const info = useAppInfo();

  return (
    <Panel title="About & legal">
      <Row label="Publisher" hint="NovaRec is published by Ife Solutions Ltd.">
        <span className="text-sm text-app2">Ife Solutions Ltd</span>
      </Row>
      <Row label="Version">
        <span className="text-sm text-app2">{info.data ? info.data.version : '—'}</span>
      </Row>
      <p className="text-xs leading-relaxed text-muted-app">
        Your recordings stay on this machine. Telemetry is off unless you turn it on above, and
        never includes file names, paths, window titles or recording content.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {LEGAL_LINKS.map((link) => (
          <button
            key={link.url}
            type="button"
            onClick={() => void window.novarec.openExternal({ url: link.url })}
            className="text-blue-400 hover:underline"
          >
            {link.label} →
          </button>
        ))}
      </div>
      <p className="text-xs text-dim-app">Copyright © 2026 Ife Solutions Ltd. MIT licensed.</p>
    </Panel>
  );
}

function GoogleAccountPanel({
  current,
  onSave,
}: {
  current: AppSettings;
  onSave: (patch: Partial<AppSettings>) => void;
}): ReactElement {
  const [clientId, setClientId] = useState(current.googleClientId ?? '');
  // Redacted by main — start blank, overwrite only on a real edit.
  const [clientSecret, setClientSecret] = useState('');
  const hasClientSecret = Boolean(current.googleClientSecret);

  return (
    <Panel title="Google account (Meet)">
      <p className="text-xs leading-relaxed text-muted-app">
        To sign in with Google inside NovaRec, create an OAuth <strong>Desktop app</strong> client
        in Google Cloud, enable the <strong>Google Meet API</strong>, and paste the client ID and
        secret here. A desktop client secret isn&apos;t confidential. Then sign in from the Meet
        section.
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <button
          type="button"
          onClick={() =>
            void window.novarec.openExternal({
              url: 'https://console.cloud.google.com/apis/credentials',
            })
          }
          className="text-blue-400 hover:underline"
        >
          Open Credentials page →
        </button>
        <button
          type="button"
          onClick={() =>
            void window.novarec.openExternal({
              url: 'https://console.cloud.google.com/apis/library/meet.googleapis.com',
            })
          }
          className="text-blue-400 hover:underline"
        >
          Enable Meet API →
        </button>
        <button
          type="button"
          onClick={() =>
            void window.novarec.openExternal({
              url: 'https://console.cloud.google.com/auth/overview',
            })
          }
          className="text-blue-400 hover:underline"
        >
          OAuth consent screen →
        </button>
      </div>
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm text-app2">Client ID</span>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            onBlur={() => onSave({ googleClientId: clientId.trim() || null })}
            placeholder="…apps.googleusercontent.com"
            spellCheck={false}
            className="w-full rounded-md bg-surface2 px-3 py-2 text-sm text-app placeholder:text-dim-app"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-app2">Client secret</span>
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            onBlur={() => {
              if (clientSecret.trim()) onSave({ googleClientSecret: clientSecret.trim() });
            }}
            placeholder={hasClientSecret ? 'Saved — type to replace' : 'GOCSPX-…'}
            spellCheck={false}
            className="w-full rounded-md bg-surface2 px-3 py-2 text-sm text-app placeholder:text-dim-app"
          />
        </label>
      </div>
    </Panel>
  );
}

function MeetingsPanel({
  current,
  onSave,
}: {
  current: AppSettings;
  onSave: (patch: Partial<AppSettings>) => void;
}): ReactElement {
  const [url, setUrl] = useState(current.livekitUrl ?? '');
  const [key, setKey] = useState(current.livekitApiKey ?? '');
  // The secret is redacted by main and never sent here — start blank and only
  // overwrite when the user actually types a replacement.
  const [secret, setSecret] = useState('');
  const hasSecret = Boolean(current.livekitApiSecret);

  return (
    <Panel title="Meetings (LiveKit)">
      <p className="text-xs leading-relaxed text-muted-app">
        NovaRec meetings run on LiveKit. Create a free project at{' '}
        <button
          type="button"
          onClick={() => void window.novarec.openExternal({ url: 'https://cloud.livekit.io' })}
          className="text-blue-400 hover:underline"
        >
          cloud.livekit.io
        </button>{' '}
        (or self-host), then paste the WebSocket URL and API key/secret here. Tokens are minted
        locally on your machine.
      </p>
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm text-app2">Server URL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => onSave({ livekitUrl: url.trim() || null })}
            placeholder="wss://your-project.livekit.cloud"
            spellCheck={false}
            className="w-full rounded-md bg-surface2 px-3 py-2 text-sm text-app placeholder:text-dim-app"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-app2">API key</span>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onBlur={() => onSave({ livekitApiKey: key.trim() || null })}
            placeholder="API…"
            spellCheck={false}
            className="w-full rounded-md bg-surface2 px-3 py-2 text-sm text-app placeholder:text-dim-app"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-app2">API secret</span>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            onBlur={() => {
              if (secret.trim()) onSave({ livekitApiSecret: secret.trim() });
            }}
            placeholder={hasSecret ? 'Saved — type to replace' : 'secret…'}
            spellCheck={false}
            className="w-full rounded-md bg-surface2 px-3 py-2 text-sm text-app placeholder:text-dim-app"
          />
        </label>
      </div>
    </Panel>
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
