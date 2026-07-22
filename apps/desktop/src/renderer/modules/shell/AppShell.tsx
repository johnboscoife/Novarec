import type { ReactElement } from 'react';
import { useAppStore, type ViewId } from '../../store.js';
import { RecordView } from '../record/RecordView.js';
import { MeetView } from '../meet/MeetView.js';
import { StudioView } from '../studio/StudioView.js';

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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-100">
      <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-neutral-800 p-3">
        <div className="mb-4 px-2 text-lg font-semibold tracking-tight">NovaRec</div>
        {NAV.map((item) => {
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => setView(item.id)}
              className={`rounded-lg px-3 py-2 text-left transition ${
                active
                  ? 'bg-neutral-800 text-white'
                  : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
              }`}
            >
              <div className="text-sm font-medium">{item.label}</div>
              <div className="text-xs text-neutral-500">{item.hint}</div>
            </button>
          );
        })}
        <div className="mt-auto px-2 text-[11px] leading-relaxed text-neutral-600">
          One capture engine · one compositor · one media pipeline
        </div>
      </nav>

      <main className="flex-1 overflow-auto">
        {view === 'record' && <RecordView />}
        {view === 'meet' && <MeetView />}
        {view === 'studio' && <StudioView />}
      </main>
    </div>
  );
}
