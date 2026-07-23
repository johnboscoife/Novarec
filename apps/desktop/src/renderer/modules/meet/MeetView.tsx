import { useState, type ReactElement } from 'react';
import { NEW_GOOGLE_MEET_URL, normalizeMeetUrl } from '@novarec/shared';
import { useAppStore } from '../../store.js';
import { useAppSettings } from '../settings/useAppSettings.js';
import { useGoogleProfile, useGoogleSignIn, useGoogleSignOut } from './useGoogleAuth.js';
import { GOOGLE_MEET_ENABLED } from '../../featureFlags.js';
import { NovaMeet } from './NovaMeet.js';

type MeetPlatform = 'google' | 'novarec';

export function MeetView(): ReactElement {
  // With Google Meet suspended there's only one platform, so skip the chooser.
  const [platform, setPlatform] = useState<MeetPlatform | null>(
    GOOGLE_MEET_ENABLED ? null : 'novarec',
  );

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
        {GOOGLE_MEET_ENABLED && platform && (
          <button
            type="button"
            onClick={() => setPlatform(null)}
            className="rounded-lg bg-surface2 px-3 py-2 text-sm text-app2 transition hover:bg-surface2"
          >
            ← Choose platform
          </button>
        )}
      </header>

      {GOOGLE_MEET_ENABLED && platform === null && <PlatformChooser onChoose={setPlatform} />}
      {GOOGLE_MEET_ENABLED && platform === 'google' && <GoogleMeetPanel />}
      {platform === 'novarec' && <NovaMeet />}
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
  const settings = useAppSettings();
  const profile = useGoogleProfile();
  const signIn = useGoogleSignIn();
  const signOut = useGoogleSignOut();
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const configured = Boolean(settings.data?.googleClientId && settings.data?.googleClientSecret);
  const account = profile.data ?? null;

  function open(url: string): void {
    void window.novarec.openExternal({ url }).catch(() => undefined);
  }

  async function startNew(): Promise<void> {
    setError(null);
    // Signed in → create a real Meet via the user's account; otherwise fall back
    // to meet.google.com/new, which uses their browser's Google session.
    if (account) {
      setCreating(true);
      try {
        const { url } = await window.novarec.googleCreateMeet();
        open(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create a meeting');
      } finally {
        setCreating(false);
      }
    } else {
      open(NEW_GOOGLE_MEET_URL);
    }
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
    <div className="max-w-3xl space-y-4">
      <GoogleAccountBar
        account={account}
        configured={configured}
        signingIn={signIn.isPending}
        signInError={signIn.error instanceof Error ? signIn.error.message : null}
        onSignIn={() => signIn.mutate()}
        onSignOut={() => signOut.mutate()}
        onOpenSettings={() => setView('settings')}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-app bg-surface p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-app">
            Start a meeting
          </h2>
          <p className="mt-2 text-sm text-muted-app">
            {account
              ? 'Creates a new Google Meet with your account and opens it in your browser.'
              : 'Opens a brand-new Google Meet in your default browser, signed in with your Google account.'}
          </p>
          <button
            type="button"
            onClick={() => void startNew()}
            disabled={creating}
            className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition enabled:hover:bg-blue-500 disabled:opacity-60"
          >
            {creating ? 'Creating…' : 'New Google Meet'}
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
            with NovaRec — your tracks stay local and yours. The recording indicator stays visible
            the whole time, and everyone should consent before you record.
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
    </div>
  );
}

function GoogleAccountBar({
  account,
  configured,
  signingIn,
  signInError,
  onSignIn,
  onSignOut,
  onOpenSettings,
}: {
  account: { email: string; name: string; picture: string | null } | null;
  configured: boolean;
  signingIn: boolean;
  signInError: string | null;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenSettings: () => void;
}): ReactElement {
  if (account) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-app bg-surface px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* Initials avatar — the strict CSP blocks remote googleusercontent
              images, and this keeps the app fully self-contained. */}
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
            {(account.name || account.email || '?').slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{account.name}</div>
            <div className="truncate text-xs text-muted-app">{account.email}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="shrink-0 rounded-lg bg-surface2 px-3 py-1.5 text-xs text-app2 transition hover:bg-surface2"
        >
          Sign out
        </button>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-app bg-surface px-4 py-3">
        <p className="min-w-0 text-sm text-muted-app">
          In-app Google sign-in needs your Google OAuth client ID.{' '}
          <span className="text-app2">The browser buttons below work without it.</span>
        </p>
        <button
          type="button"
          onClick={onOpenSettings}
          className="shrink-0 rounded-lg bg-surface2 px-3 py-2 text-sm font-medium text-app2 transition hover:bg-surface2"
        >
          Set up in Settings
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-app bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-app">Sign in to create meetings from your account.</p>
        <button
          type="button"
          onClick={onSignIn}
          disabled={signingIn}
          className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition enabled:hover:bg-blue-500 disabled:opacity-60"
        >
          {signingIn ? 'Signing in…' : 'Sign in with Google'}
        </button>
      </div>
      {signInError && <p className="mt-2 text-sm text-red-400">{signInError}</p>}
    </div>
  );
}
