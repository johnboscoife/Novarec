import { create } from 'zustand';
import { EXPORT_PRESETS } from '@novarec/shared';

/**
 * App-wide export job. Lives outside any view so an export keeps running (and
 * stays visible) when the user switches from Record to Meet/Studio or minimizes
 * the window — the FFmpeg encode itself runs in the main process, so it never
 * stops for a backgrounded renderer; this store just keeps the UI attached to it.
 * One job at a time.
 */
export type ExportStatus = 'idle' | 'running' | 'done' | 'error';

interface ExportStore {
  status: ExportStatus;
  progress: number; // 0..1
  outputPath: string | null;
  error: string | null;
  dir: string | null; // recording dir this job is for
  start: (dir: string) => void;
  reset: () => void;
}

export const useExportStore = create<ExportStore>()((set, get) => ({
  status: 'idle',
  progress: 0,
  outputPath: null,
  error: null,
  dir: null,
  reset: () => set({ status: 'idle', progress: 0, outputPath: null, error: null, dir: null }),
  start: (dir) => {
    if (get().status === 'running') return;
    const youtube = EXPORT_PRESETS.find((p) => p.id === 'youtube');
    if (!youtube) return;
    set({ status: 'running', progress: 0, outputPath: null, error: null, dir });

    const off = window.novarec.onExportProgress(({ elapsedMs, totalMs }) => {
      set({ progress: totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 0 });
    });
    window.novarec
      .runExport({ recordingDir: dir, settings: youtube.settings })
      .then(async ({ outputPath }) => {
        set({ status: 'done', progress: 1, outputPath });
        await window.novarec.revealPath({ path: outputPath }).catch(() => undefined);
      })
      .catch((e: unknown) => {
        set({ status: 'error', error: e instanceof Error ? e.message : 'Export failed' });
      })
      .finally(() => off());
  },
}));
