import { create } from 'zustand';

export type ViewId = 'record' | 'meet' | 'studio' | 'exports' | 'settings';

interface AppState {
  view: ViewId;
  setView: (view: ViewId) => void;
  // How many recorders are currently active (Record/Studio/Meet each own one).
  // Nav is locked while any is > 0 so a stray tab switch can't orphan a take.
  recordingCount: number;
  setRecordingActive: (active: boolean) => void;
}

// zustand v5 requires the curried form when the state type is provided.
export const useAppStore = create<AppState>()((set) => ({
  view: 'record',
  setView: (view) => set({ view }),
  recordingCount: 0,
  setRecordingActive: (active) =>
    set((s) => ({ recordingCount: Math.max(0, s.recordingCount + (active ? 1 : -1)) })),
}));
