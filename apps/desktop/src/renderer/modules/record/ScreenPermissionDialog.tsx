import { useEffect, type ReactElement } from 'react';

/**
 * macOS has not allowed NovaRec to record the screen. Shown instead of letting
 * a take start and fail, with the one place the user can fix it.
 */
export function ScreenPermissionDialog({
  audioOnlyAvailable,
  onAudioOnly,
  onClose,
}: {
  audioOnlyAvailable: boolean;
  onAudioOnly: () => void;
  onClose: () => void;
}): ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="screen-permission-title"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-app bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="screen-permission-title" className="text-lg font-semibold">
          Allow NovaRec to record your screen
        </h2>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted-app">
          <li>Open System Settings with the button below.</li>
          <li>
            Under <span className="text-app2">Screen &amp; System Audio Recording</span>, turn on{' '}
            <span className="text-app2">NovaRec</span>.
          </li>
          <li>
            When macOS asks, choose <span className="text-app2">Quit &amp; Reopen</span> — the
            permission only applies after NovaRec restarts.
          </li>
        </ol>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          {audioOnlyAvailable ? (
            <button
              type="button"
              onClick={onAudioOnly}
              className="text-sm text-muted-app hover:text-app hover:underline"
            >
              Record audio only
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-surface2 px-4 py-2 text-sm text-app2 hover:ring-1 hover:ring-app"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void window.novarec.openScreenSettings()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              Open System Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
