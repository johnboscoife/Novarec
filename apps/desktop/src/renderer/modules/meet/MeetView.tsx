import { useState, type ReactElement, type ReactNode } from 'react';
import { NEW_GOOGLE_MEET_URL, normalizeMeetUrl } from '@novarec/shared';
import { useAppStore } from '../../store.js';

type MeetPlatform = 'google' | 'novarec';

export function MeetView(): ReactElement {
  const [platform, setPlatform] = useState<MeetPlatform | null>(null);

  return (
    <section className="flex h-full flex-col overflow-auto p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-app">Meet</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {platform === 'google'
              ? 'Google Meet'
              : platform === 'novarec'
                ? 'NovaRec Meeting'
                : 'Start or join a meeting'}
          </h1>
        </div>
        {platform && (
          <button
            type="button"
            onClick={() => setPlatform(null)}
            className="rounded-lg bg-surface2 px-3 py-2 text-sm text-app2 transition hover:bg-surface2"
          >
            ← Choose platform
          </button>
        )}
      </header>

      {platform === null && <PlatformChooser onChoose={setPlatform} />}
      {platform === 'google' && <GoogleMeetPanel />}
      {platform === 'novarec' && <NovaRecMeetingPanel />}
    </section>
  );
}

function PlatformChooser({ onChoose }: { onChoose: (p: MeetPlatform) => void }): ReactElement {
  return (
    <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <PlatformCard
        title="Google Meet"
        status="Ready"
        statusClass="text-emerald-400"
        description="Start or join a real Google Meet in your browser, then record it with NovaRec. Uses your browser's Google sign-in — nothing to configure."
        cta="Use Google Meet"
        onChoose={() => onChoose('google')}
      />
      <PlatformCard
        title="NovaRec Meeting"
        status="In development"
        statusClass="text-amber-400"
        description="A private, end-to-end meeting hosted by NovaRec on the same capture pipeline as Record — per-participant tracks and local-first recording. Signaling and consent are built; the live call UI is coming."
        cta="Preview"
        onChoose={() => onChoose('novarec')}
      />
    </div>
  );
}

function PlatformCard({
  title,
  status,
  statusClass,
  description,
  cta,
  onChoose,
}: {
  title: string;
  status: string;
  statusClass: string;
  description: string;
  cta: string;
  onChoose: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onChoose}
      className="flex flex-col rounded-2xl border border-app bg-surface p-5 text-left transition hover:border-blue-500/60"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className={`text-xs font-medium uppercase tracking-wider ${statusClass}`}>
          {status}
        </span>
      </div>
      <p className="flex-1 text-sm leading-relaxed text-muted-app">{description}</p>
      <span className="mt-4 text-sm font-medium text-blue-400">{cta} →</span>
    </button>
  );
}

function GoogleMeetPanel(): ReactElement {
  const setView = useAppStore((s) => s.setView);
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);

  function open(url: string): void {
    void window.novarec.openExternal({ url }).catch(() => undefined);
  }

  function startNew(): void {
    setError(null);
    open(NEW_GOOGLE_MEET_URL);
  }

  function join(): void {
    const url = normalizeMeetUrl(link);
    if (!url) {
      setError('Enter a Google Meet link or code (like abc-defg-hij).');
      return;
    }
    setError(null);
    open(url);
  }

  return (
    <div className="grid max-w-3xl gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-app bg-surface p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-app">
          Start a meeting
        </h2>
        <p className="mt-2 text-sm text-muted-app">
          Opens a brand-new Google Meet in your default browser, signed in with your Google account.
        </p>
        <button
          type="button"
          onClick={startNew}
          className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
        >
          New Google Meet
        </button>

        <div className="mt-6 border-t border-app pt-5">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-app">
            Join with a link
          </h3>
          <div className="mt-3 flex gap-2">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') join();
              }}
              placeholder="meet.google.com/abc-defg-hij"
              className="min-w-0 flex-1 rounded-lg bg-surface2 px-3 py-2.5 text-sm text-app placeholder:text-dim-app"
            />
            <button
              type="button"
              onClick={join}
              disabled={link.trim().length === 0}
              className="shrink-0 rounded-lg bg-surface2 px-4 py-2.5 text-sm font-medium text-app2 transition enabled:hover:bg-surface2 disabled:opacity-50"
            >
              Join
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </div>
      </div>

      <div className="flex flex-col rounded-2xl border border-app bg-surface p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-app">
          Record the meeting
        </h2>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-app">
          Google Meet runs in your browser. To capture it, record the Meet window (or full screen)
          with NovaRec — your tracks stay local and yours. The recording indicator stays visible the
          whole time, and everyone should consent before you record.
        </p>
        <button
          type="button"
          onClick={() => setView('record')}
          className="mt-4 w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500"
        >
          Record this meeting
        </button>
        <p className="mt-2 text-xs text-dim-app">
          Opens Record — pick the Meet window or screen, then hit Record.
        </p>
      </div>
    </div>
  );
}

function NovaRecMeetingPanel(): ReactElement {
  return (
    <div className="max-w-2xl rounded-2xl border border-app bg-surface p-6">
      <h2 className="text-lg font-semibold">NovaRec Meeting — in development</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-app">
        NovaRec&apos;s own meeting hosts a private, end-to-end video call on the same capture
        pipeline as Record: every participant is a separate track, recording is local-first, and
        consent is enforced before capture can start. The signaling, token, and consent engine is
        already built and tested; the live in-app call experience is the next milestone.
      </p>
      <div className="mt-4 space-y-2">
        <Feature done>Per-participant consent ledger (recording blocked until all agree)</Feature>
        <Feature done>Room tokens &amp; roles (host / participant)</Feature>
        <Feature>Live audio/video call surface</Feature>
        <Feature>Per-participant local track recording</Feature>
      </div>
      <p className="mt-5 text-sm text-muted-app">
        Need a meeting today? Use <span className="text-app2">Google Meet</span> — it&apos;s ready
        and records with NovaRec.
      </p>
    </div>
  );
}

function Feature({
  children,
  done = false,
}: {
  children: ReactNode;
  done?: boolean;
}): ReactElement {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
          done ? 'bg-emerald-500/20 text-emerald-400' : 'bg-surface2 text-dim-app'
        }`}
        aria-hidden
      >
        {done ? '✓' : '•'}
      </span>
      <span className={done ? 'text-app2' : 'text-muted-app'}>{children}</span>
    </div>
  );
}
