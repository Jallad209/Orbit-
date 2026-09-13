import type { Energy, LocalDate, PlanSettings, TimeWindow } from '@orbit/core';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * The user's planning preferences. Working window and rest boundaries are
 * edited on the Settings screen (week 9); today's energy is picked on the
 * Today screen. Kept in localStorage: preferences, not data.
 */
export interface PlanPrefs {
  workingWindow: TimeWindow;
  restBoundaries: TimeWindow[];
  energyByDate: Record<LocalDate, Energy>;
  setEnergy: (date: LocalDate, energy: Energy) => void;
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
      energyByDate: {},
      setEnergy: (date, energy) =>
        set((s) => ({ energyByDate: { ...s.energyByDate, [date]: energy } })),
      setWorkingWindow: (workingWindow) => set({ workingWindow }),
      setRestBoundaries: (restBoundaries) => set({ restBoundaries }),
    }),
    {
      name: 'orbit-plan-prefs',
      storage: createJSONStorage(() => safeStorage()),
      partialize: (s) => ({
        workingWindow: s.workingWindow,
        restBoundaries: s.restBoundaries,
        energyByDate: s.energyByDate,
      }),
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
  prefs: Pick<PlanPrefs, 'workingWindow' | 'restBoundaries' | 'energyByDate'>,
  date: LocalDate,
  excludeTaskIds: readonly string[],
): Partial<PlanSettings> {
  return {
    workingWindow: prefs.workingWindow,
    restBoundaries: prefs.restBoundaries,
    energy: prefs.energyByDate[date] ?? 'medium',
    excludeTaskIds,
  };
}
