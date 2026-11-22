import type { ReactElement } from 'react';

/**
 * Says why no screens or windows are listed, instead of an empty picker.
 *
 * The common case is macOS without Screen Recording permission, where the main
 * process sends step-by-step instructions as the error message.
 */
export function SourcesErrorNotice({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}): ReactElement | null {
  if (!error) return null;
  const raw = error instanceof Error ? error.message : String(error);
  // ipcRenderer.invoke wraps main-process errors in its own prefix.
  const message = raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200"
    >
      <span>
        <span className="font-medium">Screens and windows can’t be listed.</span> {message}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-lg border border-amber-500/40 px-3 py-1 text-xs font-medium hover:bg-amber-500/20"
      >
        Try again
      </button>
    </div>
  );
}
