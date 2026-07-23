import { create } from 'zustand';

export type ViewId = 'record' | 'meet' | 'studio' | 'settings';

interface AppState {
  view: ViewId;
  setView: (view: ViewId) => void;
}

// zustand v5 requires the curried form when the state type is provided.
export const useAppStore = create<AppState>()((set) => ({
  view: 'record',
  setView: (view) => set({ view }),
}));
