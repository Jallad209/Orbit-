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
  /** Desktop: keep running for reminders when the window closes (tray in week 12). */
  closeToTray: boolean;
  /** Appearance: shorten every animation regardless of the OS setting. */
  reduceMotion: boolean;
  setStorageStatus: (status: StorageStatus) => void;
  dismissStorageBanner: () => void;
  setOfflineReady: (ready: boolean) => void;
  setUpdateAvailable: (available: boolean) => void;
  bump: () => void;
  setQuickCaptureOpen: (open: boolean) => void;
  setCloseToTray: (on: boolean) => void;
  setReduceMotion: (on: boolean) => void;
}

const CLOSE_TO_TRAY_KEY = 'orbit-close-to-tray';
const REDUCE_MOTION_KEY = 'orbit-reduce-motion';
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* preference only */
  }
}

/** Reflect the preference on the root element; tokens.css shortens animations under it. */
export function applyReduceMotion(on: boolean): void {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.dataset.motion = 'reduced';
  else delete document.documentElement.dataset.motion;
}
applyReduceMotion(readFlag(REDUCE_MOTION_KEY));

export const useAppStore = create<AppState>((set) => ({
  storageStatus: null,
  storageBannerDismissed: false,
  offlineReady: false,
  updateAvailable: false,
  dataVersion: 0,
  quickCaptureOpen: false,
  closeToTray: readFlag(CLOSE_TO_TRAY_KEY),
  reduceMotion: readFlag(REDUCE_MOTION_KEY),
  setStorageStatus: (storageStatus) => set({ storageStatus }),
  dismissStorageBanner: () => set({ storageBannerDismissed: true }),
  setOfflineReady: (offlineReady) => set({ offlineReady }),
  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),
  bump: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
  setQuickCaptureOpen: (quickCaptureOpen) => set({ quickCaptureOpen }),
  setCloseToTray: (closeToTray) => {
    writeFlag(CLOSE_TO_TRAY_KEY, closeToTray);
    set({ closeToTray });
  },
  setReduceMotion: (reduceMotion) => {
    writeFlag(REDUCE_MOTION_KEY, reduceMotion);
    applyReduceMotion(reduceMotion);
    set({ reduceMotion });
  },
}));
