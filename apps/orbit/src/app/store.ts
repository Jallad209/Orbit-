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
  /** Desktop: the shell began an orderly shutdown; new writes are refused with a message. */
  quitting: boolean;
  /** How many times the reminder queue has been reconciled; readiness waits for the first. */
  reminderReconciles: number;
  /** Appearance: shorten every animation regardless of the OS setting. */
  reduceMotion: boolean;
  setStorageStatus: (status: StorageStatus) => void;
  dismissStorageBanner: () => void;
  setOfflineReady: (ready: boolean) => void;
  setUpdateAvailable: (available: boolean) => void;
  bump: () => void;
  setQuickCaptureOpen: (open: boolean) => void;
  setQuitting: (on: boolean) => void;
  noteReminderReconcile: () => void;
  setReduceMotion: (on: boolean) => void;
}

// The week-10 close-to-tray flag now lives in the shell's native preferences; the raw
// localStorage value is read once by the resident bridge for the migration.
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
  quitting: false,
  reminderReconciles: 0,
  reduceMotion: readFlag(REDUCE_MOTION_KEY),
  setStorageStatus: (storageStatus) => set({ storageStatus }),
  dismissStorageBanner: () => set({ storageBannerDismissed: true }),
  setOfflineReady: (offlineReady) => set({ offlineReady }),
  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),
  bump: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
  setQuickCaptureOpen: (quickCaptureOpen) => set({ quickCaptureOpen }),
  setQuitting: (quitting) => set({ quitting }),
  noteReminderReconcile: () => set((s) => ({ reminderReconciles: s.reminderReconciles + 1 })),
  setReduceMotion: (reduceMotion) => {
    writeFlag(REDUCE_MOTION_KEY, reduceMotion);
    applyReduceMotion(reduceMotion);
    set({ reduceMotion });
  },
}));
