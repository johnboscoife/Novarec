import { useEffect, type ReactElement } from 'react';
import type { Theme } from '@novarec/shared';
import { useAppStore, type ViewId } from '../../store.js';
import { RecordView } from '../record/RecordView.js';
import { MeetView } from '../meet/MeetView.js';
import { StudioView } from '../studio/StudioView.js';
import { ExportsView } from '../exports/ExportsView.js';
import { SettingsView } from '../settings/SettingsView.js';
import { useAppSettings, useSaveAppSettings } from '../settings/useAppSettings.js';
import { Onboarding } from './Onboarding.js';
import { LogoWordmark } from '../../components/Logo.js';
import { useExportStore } from '../../exportStore.js';

interface NavItem {
  id: ViewId;
  label: string;
  hint: string;
}

const NAV: readonly NavItem[] = [
  { id: 'record', label: 'Record', hint: 'Screen recorder' },
  { id: 'meet', label: 'Meet', hint: 'Video meetings' },
  { id: 'studio', label: 'Studio', hint: 'Live compositor' },
  { id: 'exports', label: 'Exports', hint: 'Your exported files' },
];

export function AppShell(): ReactElement {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const settings = useAppSettings();
  const saveSettings = useSaveAppSettings();
  const appSettings = settings.data;
  const showOnboarding = settings.data !== undefined && !settings.data.onboardingComplete;

  function completeOnboarding(): void {
    setView('record');
    if (settings.data) saveSettings.mutate({ ...settings.data, onboardingComplete: true });
  }

  // Apply theme + reduced-motion to the document root.
  useEffect(() => {
    const root = document.documentElement;
    const theme = settings.data?.theme ?? 'system';
    const resolved =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
        : theme;
    root.dataset.theme = resolved;
    root.classList.toggle('reduce-motion', settings.data?.reducedMotion ?? false);
  }, [settings.data]);

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-app text-app">
      {showOnboarding && <Onboarding onStart={completeOnboarding} />}
      <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-app p-3">
        <div className="mb-4 px-1 py-1">
          <LogoWordmark />
        </div>
        {NAV.map((item) => (
          <NavButton key={item.id} item={item} active={view === item.id} onSelect={setView} />
        ))}
        <div className="mt-auto space-y-2">
          <ExportIndicator />
          {appSettings && (
            <button
              type="button"
              onClick={() =>
                saveSettings.mutate({
                  ...appSettings,
                  theme: resolveTheme(appSettings.theme) === 'dark' ? 'light' : 'dark',
                })
              }
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted-app transition hover:bg-surface hover:text-app2"
            >
              <span aria-hidden>{resolveTheme(appSettings.theme) === 'dark' ? '☀️' : '🌙'}</span>
              <span>{resolveTheme(appSettings.theme) === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
          )}
          <NavButton
            item={{ id: 'settings', label: 'Settings', hint: 'Preferences & privacy' }}
            active={view === 'settings'}
            onSelect={setView}
          />
          <div className="px-2 text-[11px] leading-relaxed text-dim-app">
            One capture engine · one compositor · one media pipeline
          </div>
        </div>
      </nav>

      <main className="flex-1 overflow-auto">
        {view === 'record' && <RecordView />}
        {view === 'meet' && <MeetView />}
        {view === 'studio' && <StudioView />}
        {view === 'exports' && <ExportsView />}
        {view === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return theme;
}

function ExportIndicator(): ReactElement | null {
  const status = useExportStore((s) => s.status);
  const progress = useExportStore((s) => s.progress);
  const outputPath = useExportStore((s) => s.outputPath);
  const reset = useExportStore((s) => s.reset);

  if (status === 'idle') return null;

  return (
    <div className="rounded-lg border border-app bg-surface px-3 py-2 text-xs">
      {status === 'running' && (
        <>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-medium text-app2">Exporting…</span>
            <span className="text-muted-app">{Math.round(progress * 100)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface2">
            <div
              className="h-full bg-blue-500 transition-[width]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </>
      )}
      {status === 'done' && (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => outputPath && void window.novarec.revealPath({ path: outputPath })}
            className="truncate text-left font-medium text-emerald-400 hover:underline"
          >
            Export ready ✓
          </button>
          <button type="button" onClick={reset} className="shrink-0 text-muted-app hover:text-app2">
            ✕
          </button>
        </div>
      )}
      {status === 'error' && (
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-red-400">Export failed</span>
          <button type="button" onClick={reset} className="shrink-0 text-muted-app hover:text-app2">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function NavButton({
  item,
  active,
  onSelect,
}: {
  item: NavItem;
  active: boolean;
  onSelect: (id: ViewId) => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(item.id)}
      className={`w-full rounded-lg px-3 py-2 text-left transition ${
        active ? 'bg-surface2 text-app' : 'text-muted-app hover:bg-surface hover:text-app2'
      }`}
    >
      <div className="text-sm font-medium">{item.label}</div>
      <div className="text-xs text-muted-app">{item.hint}</div>
    </button>
  );
}
