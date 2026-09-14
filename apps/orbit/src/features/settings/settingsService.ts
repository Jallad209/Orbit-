import {
  APP_SETTINGS_ID,
  AppSettingsSchema,
  DEFAULT_INSIGHT_SETTINGS,
  TimeWindowSchema,
  defaultAppSettings,
  systemClock,
} from '@orbit/core';
import type { AppSettings, BaseRecord, Clock, InsightSettings } from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { z } from 'zod';
import { bumpData } from '@/data/useQuery';
import { usePlanPrefs } from '@/features/today/planSettings';

export type SettingsPatch = Partial<Omit<AppSettings, keyof BaseRecord | 'insights'>> & {
  /** A partial insight group merges field by field into the stored one. */
  insights?: Partial<InsightSettings>;
};

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
 * The settings document as stored, without creating it. Adapters normalize
 * old rows on read (week 11), so the result always has every group; when
 * there is no document yet the defaults are returned and nothing is written.
 */
export async function readSettings(
  repo: Repository,
  clock: Clock = systemClock,
): Promise<AppSettings> {
  const existing = await repo.appSettings.get(APP_SETTINGS_ID);
  return existing && existing.deletedAt === null ? existing : defaultAppSettings(clock);
}

/**
 * The settings document, created on first read. An install upgraded from
 * the localStorage era keeps its working window and rest boundaries: they
 * are copied into the document once, then localStorage is ignored.
 */
export async function loadSettings(
  repo: Repository,
  clock: Clock = systemClock,
  options: { migrateLegacy?: boolean } = {},
): Promise<AppSettings> {
  const existing = await repo.appSettings.get(APP_SETTINGS_ID);
  if (existing && existing.deletedAt === null) {
    usePlanPrefs.getState().hydrate(existing);
    return existing;
  }
  const fresh = AppSettingsSchema.parse({
    ...defaultAppSettings(clock),
    ...(options.migrateLegacy === false ? {} : legacyPrefs()),
  });
  const stored = await repo.appSettings.upsert(fresh);
  usePlanPrefs.getState().hydrate(stored);
  return stored;
}

/** Task creation reads the persisted default without creating settings as a side effect. */
export async function defaultTaskEstimate(
  repo: Repository,
  clock: Clock = systemClock,
): Promise<number> {
  return (await readSettings(repo, clock)).defaultEstimateMin;
}

/**
 * Merge a patch into a fresh copy of the document inside one transaction:
 * the row is re-read there, so a Settings form left open in one window
 * cannot overwrite what another window (or an import) saved since, and the
 * insight group merges field by field rather than replacing the working
 * window along with it. Validated through the shared schema; an
 * out-of-bounds value throws and nothing is written.
 */
export async function saveSettings(
  repo: Repository,
  patch: SettingsPatch,
  clock: Clock = systemClock,
): Promise<AppSettings> {
  const stored = await repo.transaction(async (tx) => {
    const current = await tx.appSettings.get(APP_SETTINGS_ID);
    const base =
      current && current.deletedAt === null
        ? current
        : AppSettingsSchema.parse({ ...defaultAppSettings(clock), ...legacyPrefs() });
    const { insights, ...rest } = patch;
    const next = AppSettingsSchema.parse({
      ...base,
      ...rest,
      insights: { ...base.insights, ...insights },
    });
    return tx.appSettings.upsert(next);
  });
  usePlanPrefs.getState().hydrate(stored);
  bumpData();
  return stored;
}

/** Put every insight threshold back to its default; planning preferences are untouched. */
export async function restoreInsightDefaults(
  repo: Repository,
  clock: Clock = systemClock,
): Promise<AppSettings> {
  return saveSettings(repo, { insights: { ...DEFAULT_INSIGHT_SETTINGS } }, clock);
}
