import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';

/**
 * Warns before a take starts if the recording volume is nearly full.
 *
 * The recorder already survives a full disk — it seals what it has and stops
 * cleanly — but the take is still cut short, and that is worth knowing about
 * beforehand rather than discovering forty minutes in. Deliberately silent
 * above the threshold: a permanent readout of free space is noise.
 */
const WARN_BELOW_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
const CRITICAL_BELOW_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB
const REFRESH_MS = 30_000;

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 10) return `${Math.round(gb)} GB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function DiskSpaceNotice(): ReactElement | null {
  const { data } = useQuery({
    queryKey: ['recording:freeSpace'],
    queryFn: () => window.novarec.freeSpace(),
    refetchInterval: REFRESH_MS,
  });

  // `freeBytes: 0` also means "couldn't read the volume" — staying quiet beats
  // claiming the disk is full when we simply don't know.
  if (!data || data.freeBytes === 0 || data.freeBytes >= WARN_BELOW_BYTES) return null;
  const critical = data.freeBytes < CRITICAL_BELOW_BYTES;

  return (
    <div
      role="status"
      className={`mb-4 rounded-xl border p-3 text-sm ${
        critical
          ? 'border-red-500/40 bg-red-500/10 text-red-200'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
      }`}
    >
      <span className="font-medium">{formatBytes(data.freeBytes)} left</span> where recordings are
      saved.{' '}
      {critical
        ? 'A recording will stop early. Free some space, or change the location in Settings → Storage.'
        : 'Long recordings may run out of room — change the location in Settings → Storage if needed.'}
    </div>
  );
}
