import type { ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * On launch, surfaces any recording that never finished (crash/kill) and offers
 * one-click recovery. "Never lose a recording" made visible to the user.
 */
export function RecoveryBanner(): ReactElement | null {
  const client = useQueryClient();
  const orphans = useQuery({
    queryKey: ['recording:orphans'],
    queryFn: () => window.novarec.listOrphans(),
  });
  const recover = useMutation({
    mutationFn: (dir: string) => window.novarec.recoverRecording({ dir }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['recording:orphans'] }),
  });

  const list = orphans.data ?? [];
  if (list.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <p className="text-sm font-medium text-amber-200">
        {list.length} recording{list.length === 1 ? '' : 's'} can be recovered
      </p>
      <p className="text-xs text-amber-200/70">
        NovaRec found segments from a session that didn&apos;t finish. Nothing was lost.
      </p>
      <ul className="mt-3 space-y-2">
        {list.map((orphan) => (
          <li
            key={orphan.dir}
            className="flex items-center justify-between rounded-lg bg-neutral-900/50 px-3 py-2"
          >
            <span className="text-xs text-neutral-300">
              {new Date(orphan.createdAt).toLocaleString()} · {orphan.sealedSegmentCount} segments ·{' '}
              {(orphan.durationMs / 1000).toFixed(1)}s
            </span>
            <button
              type="button"
              disabled={recover.isPending}
              onClick={() => recover.mutate(orphan.dir)}
              className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-amber-400 disabled:opacity-60"
            >
              {recover.isPending ? 'Recovering…' : 'Recover'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
