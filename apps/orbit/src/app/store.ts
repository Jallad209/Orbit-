import { create } from 'zustand';
import type { StorageStatus } from '@/platform/types';

/**
 * App-level UI state that is not domain data: storage health, PWA state,
 * dismissed banners, and the data version counter that invalidates queries.
 * Domain state lives in the repository.
 */
interface AppState {
  storageStatus: StorageStatus | null;
  storageBannerDismissed: boolean;
  offlineReady: boolean;
  updateAvailable: boolean;
  /** Incremented after every write; `useRepoQuery` re-reads when it changes. */
  dataVersion: number;
  quickCaptureOpen: boolean;
  setStorageStatus: (status: StorageStatus) => void;
  dismissStorageBanner: () => void;
  setOfflineReady: (ready: boolean) => void;
  setUpdateAvailable: (available: boolean) => void;
  bump: () => void;
  setQuickCaptureOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  storageStatus: null,
  storageBannerDismissed: false,
  offlineReady: false,
  updateAvailable: false,
  dataVersion: 0,
  quickCaptureOpen: false,
  setStorageStatus: (storageStatus) => set({ storageStatus }),
  dismissStorageBanner: () => set({ storageBannerDismissed: true }),
  setOfflineReady: (offlineReady) => set({ offlineReady }),
  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),
  bump: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
  setQuickCaptureOpen: (quickCaptureOpen) => set({ quickCaptureOpen }),
}));
