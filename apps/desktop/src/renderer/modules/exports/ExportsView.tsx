import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExportHistoryEntry } from '@novarec/shared';
import { useAppSettings, useSaveAppSettings } from '../settings/useAppSettings.js';

function formatSize(bytes: number): string {
  if (bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ExportsView(): ReactElement {
  const settings = useAppSettings();
  const saveSettings = useSaveAppSettings();
  const client = useQueryClient();

  const history = useQuery<ExportHistoryEntry[]>({
    queryKey: ['export:history'],
    queryFn: () => window.novarec.exportHistory(),
    refetchOnMount: 'always',
  });

  const rename = useMutation({
    mutationFn: (vars: { id: string; name: string }) => window.novarec.renameExport(vars),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['export:history'] }),
  });
  const remove = useMutation({
    mutationFn: (vars: { id: string; deleteFile: boolean }) => window.novarec.removeExport(vars),
    onSuccess: (entries) => client.setQueryData(['export:history'], entries),
  });

  async function changeFolder(): Promise<void> {
    const { path } = await window.novarec.chooseExportFolder();
    if (path && settings.data) saveSettings.mutate({ ...settings.data, exportFolder: path });
  }

  const entries = history.data ?? [];
  const folder = settings.data?.exportFolder ?? null;

  return (
    <section className="flex h-full flex-col overflow-auto p-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-app">Exports</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Your exported files</h1>
        </div>
        <button
          type="button"
          onClick={() => void window.novarec.revealRecordings()}
          title="Open the folder holding raw and recovered recordings"
          className="shrink-0 rounded-lg bg-surface2 px-3 py-2 text-sm font-medium text-app2 transition hover:text-app"
        >
          Reveal recordings folder
        </button>
      </header>

      <div className="max-w-3xl space-y-6">
        <div className="rounded-2xl border border-app bg-surface p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-app">
            Destination folder
          </h2>
          <div className="mt-3 flex items-center justify-between gap-4">
            <p className="min-w-0 truncate text-sm text-app2">
              {folder ?? 'Default — your Videos\\NovaRec folder'}
            </p>
            <div className="flex shrink-0 gap-2">
              {folder && (
                <button
                  type="button"
                  onClick={() =>
                    settings.data && saveSettings.mutate({ ...settings.data, exportFolder: null })
                  }
                  className="rounded-lg bg-surface2 px-3 py-2 text-sm text-muted-app transition hover:text-app2"
                >
                  Reset
                </button>
              )}
              <button
                type="button"
                onClick={() => void changeFolder()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
              >
                Change…
              </button>
            </div>
          </div>
          {settings.data && (
            <label className="mt-4 flex items-center gap-2 text-sm text-app2">
              <input
                type="checkbox"
                checked={settings.data.deleteRawAfterExport}
                onChange={(e) =>
                  settings.data &&
                  saveSettings.mutate({
                    ...settings.data,
                    deleteRawAfterExport: e.target.checked,
                  })
                }
                className="accent-blue-500"
              />
              Delete the original recording automatically after each export
            </label>
          )}
        </div>

        <div className="rounded-2xl border border-app bg-surface p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-app">
            History ({entries.length})
          </h2>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-app">
              No exports yet. Finish a recording and export it — it&apos;ll show up here.
            </p>
          ) : (
            <ul className="space-y-2">
              {entries.map((entry) => (
                <HistoryRow
                  key={entry.id}
                  entry={entry}
                  onRename={(name) => rename.mutate({ id: entry.id, name })}
                  onReveal={() => void window.novarec.revealPath({ path: entry.path })}
                  onRemove={(deleteFile) => remove.mutate({ id: entry.id, deleteFile })}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function HistoryRow({
  entry,
  onRename,
  onReveal,
  onRemove,
}: {
  entry: ExportHistoryEntry;
  onRename: (name: string) => void;
  onReveal: () => void;
  onRemove: (deleteFile: boolean) => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entry.name);

  function commit(): void {
    setEditing(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== entry.name) onRename(trimmed);
    else setName(entry.name);
  }

  return (
    <li className="flex items-center gap-3 rounded-lg border border-app bg-app px-3 py-2">
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setName(entry.name);
                setEditing(false);
              }
            }}
            className="w-full rounded bg-surface2 px-2 py-1 text-sm text-app"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Click to rename"
            className="block max-w-full truncate text-left text-sm font-medium text-app2 hover:text-app"
          >
            {entry.name}
          </button>
        )}
        <p className="text-xs text-muted-app">
          {formatSize(entry.sizeBytes)} · {formatDate(entry.createdAtMs)}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <RowButton label="Rename" onClick={() => setEditing(true)}>
          ✎
        </RowButton>
        <RowButton label="Show in folder" onClick={onReveal}>
          📂
        </RowButton>
        <RowButton label="Remove from list" onClick={() => onRemove(false)}>
          ✕
        </RowButton>
        <RowButton label="Delete file" tone="danger" onClick={() => onRemove(true)}>
          🗑
        </RowButton>
      </div>
    </li>
  );
}

function RowButton({
  children,
  label,
  onClick,
  tone = 'default',
}: {
  children: string;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
}): ReactElement {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md text-sm transition ${
        tone === 'danger'
          ? 'bg-surface2 text-red-400 hover:bg-red-500/20'
          : 'bg-surface2 text-app2 hover:bg-surface2'
      }`}
    >
      {children}
    </button>
  );
}
