import { create } from 'zustand';
import type { StorageStatus } from '@/platform/types';

/**
 * App-level UI state that is not domain data: storage health, PWA state,
 * dismissed banners. Domain state lives in the repository.
 */
interface AppState {
  storageStatus: StorageStatus | null;
  storageBannerDismissed: boolean;
  offlineReady: boolean;
  updateAvailable: boolean;
  setStorageStatus: (status: StorageStatus) => void;
  dismissStorageBanner: () => void;
  setOfflineReady: (ready: boolean) => void;
  setUpdateAvailable: (available: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  storageStatus: null,
  storageBannerDismissed: false,
  offlineReady: false,
  updateAvailable: false,
  setStorageStatus: (storageStatus) => set({ storageStatus }),
  dismissStorageBanner: () => set({ storageBannerDismissed: true }),
  setOfflineReady: (offlineReady) => set({ offlineReady }),
  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),
}));
