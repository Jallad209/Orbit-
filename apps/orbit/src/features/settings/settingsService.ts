import {
  APP_SETTINGS_ID,
  AppSettingsSchema,
  TimeWindowSchema,
  defaultAppSettings,
  systemClock,
} from '@orbit/core';
import type { AppSettings, BaseRecord, Clock } from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { z } from 'zod';
import { bumpData } from '@/data/useQuery';
import { usePlanPrefs } from '@/features/today/planSettings';

export type SettingsPatch = Partial<Omit<AppSettings, keyof BaseRecord>>;

/** What week 5–8 kept in localStorage; read once when the document is first created. */
const LEGACY_KEY = 'orbit-plan-prefs';
const LegacyPrefs = z.object({
  state: z
    .object({
      workingWindow: TimeWindowSchema.optional(),
      restBoundaries: z.array(TimeWindowSchema).optional(),
    })
    .partial(),
});

function legacyPrefs(): SettingsPatch {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(LEGACY_KEY);
    const parsed = raw ? LegacyPrefs.safeParse(JSON.parse(raw)) : null;
    if (parsed?.success) {
      const { workingWindow, restBoundaries } = parsed.data.state;
      if (workingWindow || restBoundaries) {
        return {
          ...(workingWindow ? { workingWindow } : {}),
          ...(restBoundaries ? { restBoundaries } : {}),
        };
      }
    }
  } catch {
    /* unreadable: fall through */
  }
  // The store rehydrated from the same file at startup and may still hold the values.
  const { workingWindow, restBoundaries } = usePlanPrefs.getState();
  return { workingWindow, restBoundaries };
}

/**
 * The settings document, created on first read. An install upgraded from
 * the localStorage era keeps its working window and rest boundaries: they
 * are copied into the document once, then localStorage is ignored.
 */
export async function loadSettings(
  repo: Repository,
  clock: Clock = systemClock,
): Promise<AppSettings> {
  const existing = await repo.appSettings.get(APP_SETTINGS_ID);
  if (existing && existing.deletedAt === null) {
    usePlanPrefs.getState().hydrate(existing);
    return existing;
  }
  const fresh = AppSettingsSchema.parse({ ...defaultAppSettings(clock), ...legacyPrefs() });
  const stored = await repo.appSettings.upsert(fresh);
  usePlanPrefs.getState().hydrate(stored);
  return stored;
}

/** Validate through the shared schema, store, and mirror into the planner prefs. */
export async function saveSettings(
  repo: Repository,
  patch: SettingsPatch,
  clock: Clock = systemClock,
): Promise<AppSettings> {
  const current = await loadSettings(repo, clock);
  const next = AppSettingsSchema.parse({ ...current, ...patch });
  const stored = await repo.appSettings.upsert(next);
  usePlanPrefs.getState().hydrate(stored);
  bumpData();
  return stored;
}
