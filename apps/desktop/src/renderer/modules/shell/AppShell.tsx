import { useEffect, type ReactElement } from 'react';
import { useAppStore, type ViewId } from '../../store.js';
import { RecordView } from '../record/RecordView.js';
import { MeetView } from '../meet/MeetView.js';
import { StudioView } from '../studio/StudioView.js';
import { SettingsView } from '../settings/SettingsView.js';
import { useAppSettings, useSaveAppSettings } from '../settings/useAppSettings.js';
import { Onboarding } from './Onboarding.js';

interface NavItem {
  id: ViewId;
  label: string;
  hint: string;
}

const NAV: readonly NavItem[] = [
  { id: 'record', label: 'Record', hint: 'Screen recorder' },
  { id: 'meet', label: 'Meet', hint: 'Video meetings' },
  { id: 'studio', label: 'Studio', hint: 'Live compositor' },
];

export function AppShell(): ReactElement {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const settings = useAppSettings();
  const saveSettings = useSaveAppSettings();
  const showOnboarding = settings.data !== undefined && !settings.data.onboardingComplete;

  function completeOnboarding(): void {
    setView('record');
    if (settings.data) saveSettings.mutate({ ...settings.data, onboardingComplete: true });
  }

  // Apply theme + reduced-motion to the document root.
  useEffect(() => {
    const root = document.documentElement;
    const theme = settings.data?.theme ?? 'system';
    root.dataset.theme = theme;
    root.style.colorScheme = theme === 'system' ? 'dark light' : theme;
    root.classList.toggle('reduce-motion', settings.data?.reducedMotion ?? false);
  }, [settings.data]);

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-100">
      {showOnboarding && <Onboarding onStart={completeOnboarding} />}
      <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-neutral-800 p-3">
        <div className="mb-4 px-2 text-lg font-semibold tracking-tight">NovaRec</div>
        {NAV.map((item) => (
          <NavButton key={item.id} item={item} active={view === item.id} onSelect={setView} />
        ))}
        <div className="mt-auto space-y-2">
          <NavButton
            item={{ id: 'settings', label: 'Settings', hint: 'Preferences & privacy' }}
            active={view === 'settings'}
            onSelect={setView}
          />
          <div className="px-2 text-[11px] leading-relaxed text-neutral-600">
            One capture engine · one compositor · one media pipeline
          </div>
        </div>
      </nav>

      <main className="flex-1 overflow-auto">
        {view === 'record' && <RecordView />}
        {view === 'meet' && <MeetView />}
        {view === 'studio' && <StudioView />}
        {view === 'settings' && <SettingsView />}
      </main>
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
        active
          ? 'bg-neutral-800 text-white'
          : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
      }`}
    >
      <div className="text-sm font-medium">{item.label}</div>
      <div className="text-xs text-neutral-500">{item.hint}</div>
    </button>
  );
}
