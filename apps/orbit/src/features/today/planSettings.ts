import type { AppSettings, Energy, LocalDate, PlanSettings, TimeWindow } from '@orbit/core';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * The planner's preferences as the screens read them. Since week 9 the
 * durable part (working window, rest boundaries, buffer, default estimate,
 * evening hour) lives in the repository's `AppSettings` document and is
 * mirrored here by `settingsService`; only today's energy choice stays in
 * localStorage, because it is a per-day mood, not data.
 */
export interface PlanPrefs {
  workingWindow: TimeWindow;
  restBoundaries: TimeWindow[];
  bufferMin: number;
  defaultEstimateMin: number;
  /** Minute of day the "Evening shutdown" launcher appears. */
  eveningStartMin: number;
  /** Whether the repository document has been read yet. */
  hydrated: boolean;
  energyByDate: Record<LocalDate, Energy>;
  setEnergy: (date: LocalDate, energy: Energy) => void;
  /** Mirror the stored document. `settingsService` is the writer. */
  hydrate: (settings: AppSettings) => void;
  /** In-memory update; tests and the first-run flow use it before a repository exists. */
  setWorkingWindow: (window: TimeWindow) => void;
  setRestBoundaries: (rest: TimeWindow[]) => void;
}

export const DEFAULT_WORKING_WINDOW: TimeWindow = { startMin: 540, endMin: 1080 };
export const DEFAULT_REST: TimeWindow[] = [{ startMin: 750, endMin: 795 }];

export const usePlanPrefs = create<PlanPrefs>()(
  persist(
    (set) => ({
      workingWindow: DEFAULT_WORKING_WINDOW,
      restBoundaries: DEFAULT_REST,
      bufferMin: 10,
      defaultEstimateMin: 30,
      eveningStartMin: 17 * 60,
      hydrated: false,
      energyByDate: {},
      setEnergy: (date, energy) =>
        set((s) => ({ energyByDate: { ...s.energyByDate, [date]: energy } })),
      hydrate: (settings) =>
        set({
          workingWindow: settings.workingWindow,
          restBoundaries: settings.restBoundaries,
          bufferMin: settings.bufferMin,
          defaultEstimateMin: settings.defaultEstimateMin,
          eveningStartMin: settings.eveningStartMin,
          hydrated: true,
        }),
      setWorkingWindow: (workingWindow) => set({ workingWindow }),
      setRestBoundaries: (restBoundaries) => set({ restBoundaries }),
    }),
    {
      name: 'orbit-plan-prefs',
      storage: createJSONStorage(() => safeStorage()),
      // The window and rest boundaries persisted here until week 9; they stay
      // in the file so `settingsService` can migrate them once, but are no
      // longer written.
      partialize: (s) => ({ energyByDate: s.energyByDate }),
    },
  ),
);

/** localStorage can throw in restricted contexts; fall back to memory. */
function safeStorage(): Storage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* blocked */
  }
  const mem = new Map<string, string>();
  return {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => void mem.set(k, v),
    removeItem: (k) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  };
}

export function settingsFor(
  prefs: Pick<PlanPrefs, 'workingWindow' | 'restBoundaries' | 'energyByDate' | 'bufferMin'>,
  date: LocalDate,
  excludeTaskIds: readonly string[],
): Partial<PlanSettings> {
  return {
    workingWindow: prefs.workingWindow,
    restBoundaries: prefs.restBoundaries,
    bufferMin: prefs.bufferMin,
    energy: prefs.energyByDate[date] ?? 'medium',
    excludeTaskIds,
  };
}
