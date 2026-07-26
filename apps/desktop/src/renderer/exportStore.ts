import { create } from 'zustand';
import type { ExportSettings } from '@novarec/shared';

/**
 * App-wide export job. Lives outside any view so an export keeps running (and
 * stays visible) when the user switches from Record to Meet/Studio or minimizes
 * the window — the FFmpeg encode itself runs in the main process, so it never
 * stops for a backgrounded renderer; this store just keeps the UI attached to it.
 *
 * Exports run one at a time but are QUEUED, not dropped: if a second recording
 * finishes (or auto-export fires) while one is still encoding, it waits its turn
 * and runs next. Dropping it silently was a real data-loss-of-work bug under the
 * core "record back-to-back with auto-export on" workflow.
 */
export type ExportStatus = 'idle' | 'running' | 'done' | 'error';

interface QueueItem {
  dir: string;
  settings: ExportSettings;
}

interface ExportStore {
  status: ExportStatus;
  progress: number; // 0..1
  outputPath: string | null;
  error: string | null;
  dir: string | null; // recording dir the CURRENT job is for
  queued: number; // jobs waiting behind the current one
  start: (dir: string, settings: ExportSettings) => void;
  reset: () => void;
}

// The pending queue lives outside store state — mutating it shouldn't trigger
// renders on its own; `queued` mirrors its length for the UI.
const pending: QueueItem[] = [];

export const useExportStore = create<ExportStore>()((set, get) => {
  function runNext(): void {
    const item = pending.shift();
    if (!item) {
      set({ queued: 0 });
      return;
    }
    set({
      status: 'running',
      progress: 0,
      outputPath: null,
      error: null,
      dir: item.dir,
      queued: pending.length,
    });

    const off = window.novarec.onExportProgress(({ elapsedMs, totalMs }) => {
      set({ progress: totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 0 });
    });
    window.novarec
      .runExport({ recordingDir: item.dir, settings: item.settings })
      .then(async ({ outputPath }) => {
        set({ status: 'done', progress: 1, outputPath });
        await window.novarec.revealPath({ path: outputPath }).catch(() => undefined);
      })
      .catch((e: unknown) => {
        set({ status: 'error', error: e instanceof Error ? e.message : 'Export failed' });
      })
      .finally(() => {
        off();
        if (pending.length > 0) runNext(); // drain the next queued export
      });
  }

  return {
    status: 'idle',
    progress: 0,
    outputPath: null,
    error: null,
    dir: null,
    queued: 0,
    reset: () => {
      // Only clears the terminal indicator — never discards queued/running work.
      if (get().status === 'running') return;
      set({ status: 'idle', progress: 0, outputPath: null, error: null, dir: null });
    },
    start: (dir, settings) => {
      // De-dupe: ignore a dir already running or already queued.
      if (get().status === 'running' && get().dir === dir) return;
      if (pending.some((p) => p.dir === dir)) return;
      pending.push({ dir, settings });
      set({ queued: pending.length });
      if (get().status !== 'running') runNext();
    },
  };
});
