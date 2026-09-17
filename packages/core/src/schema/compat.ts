import { z } from 'zod';
import { BaseRecordSchema } from './common';
import {
  AppSettingsSchema,
  BillSchema,
  InsightSettingsSchema,
  InsightStateSchema,
  ReviewSettingsSchema,
  type AppSettings,
  type Bill,
  type InsightState,
} from './entities';

/**
 * Old records at the read boundary (week 11). Stored rows are JSON written
 * by whichever version of Orbit last saved them: an install upgraded from
 * week 9 has a settings document without `insights` and insight states
 * without `snoozeMode`. Zod defaults cover the missing-field case only when
 * a record is parsed, and adapters return stored rows without parsing, so
 * every adapter, import, and restore path runs these first.
 *
 * Policy:
 * - a missing field takes its documented default;
 * - a present but malformed value is repaired to the default and reported
 *   in `repairs`, so a caller can log or show it; the record is never
 *   thrown away for one bad threshold;
 * - a record whose base fields (id, timestamps) are invalid is corrupt and
 *   throws: nothing sensible can be built from it.
 */

export interface Normalized<T> {
  record: T;
  /** Field paths that held malformed values and were reset to defaults. */
  repairs: string[];
}

function isObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/** Repair one object's fields individually against `shape`, collecting what was reset. */
function repairShape(
  raw: Record<string, unknown>,
  shape: z.ZodRawShape,
  path: string,
  repairs: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(shape)) {
    const value = raw[key];
    if (value === undefined) continue; // Zod fills the default
    const parsed = field.safeParse(value);
    if (parsed.success) out[key] = parsed.data;
    else repairs.push(path ? `${path}.${key}` : key);
  }
  return out;
}

/** The settings document as this build understands it, whatever version wrote it. */
export function normalizeAppSettings(raw: unknown): Normalized<AppSettings> {
  const direct = AppSettingsSchema.safeParse(raw);
  if (direct.success) return { record: direct.data, repairs: [] };
  if (!isObject(raw)) throw new Error('The settings record is not an object.');
  const base = BaseRecordSchema.parse(raw);
  const repairs: string[] = [];
  const { insights, reviews, ...rest } = AppSettingsSchema.shape;
  const top = repairShape(raw, rest, '', repairs);
  // The insight group is repaired field by field rather than reset as a whole.
  if (isObject(raw.insights)) {
    top.insights = repairShape(raw.insights, InsightSettingsSchema.shape, 'insights', repairs);
  } else if (raw.insights !== undefined && !insights.safeParse(raw.insights).success) {
    repairs.push('insights');
  }
  if (isObject(raw.reviews)) {
    top.reviews = repairShape(raw.reviews, ReviewSettingsSchema.shape, 'reviews', repairs);
  } else if (raw.reviews !== undefined && !reviews.safeParse(raw.reviews).success) {
    repairs.push('reviews');
  }
  return { record: AppSettingsSchema.parse({ ...top, ...base }), repairs };
}

/**
 * An insight state row from any version. A week-9 row knew only
 * `snoozedUntil` and `dismissedAt`: a non-null snooze becomes a timed one,
 * a dismissal stays permanent, and the history summary is absent (the UI
 * shows a generic "previously dismissed observation" for it).
 */
export function normalizeInsightState(raw: unknown): Normalized<InsightState> {
  if (!isObject(raw)) throw new Error('The insight state record is not an object.');
  const repairs: string[] = [];
  const draft: Record<string, unknown> = { ...raw };
  if (
    (draft.snoozeMode === undefined || draft.snoozeMode === null) &&
    typeof draft.snoozedUntil === 'string'
  ) {
    draft.snoozeMode = 'time';
  }
  const direct = InsightStateSchema.safeParse(draft);
  if (direct.success) return { record: direct.data, repairs };
  const base = BaseRecordSchema.parse(raw);
  const top = repairShape(draft, InsightStateSchema.shape, '', repairs);
  if (typeof top.insightKey !== 'string') throw new Error('The insight state has no key.');
  return { record: InsightStateSchema.parse({ ...top, ...base }), repairs };
}

/**
 * A bill row from any version (week 12). A recurring bill written before
 * the occurrence fields existed is its own series root: its id is the
 * series id, its due date is the anchor and the scheduled date, and it is
 * occurrence zero. A paid legacy row keeps `paidAt` null — "payment time
 * not recorded" — rather than acquiring an invented timestamp. Nothing here
 * generates a successor, claims a payment happened, or looks at the clock.
 */
export function normalizeBill(raw: unknown): Normalized<Bill> {
  if (!isObject(raw)) throw new Error('The bill record is not an object.');
  const repairs: string[] = [];
  const recurring = isObject(raw.recurrence);
  /** A recurring row without a series is its own root, anchored where it is due. */
  const asRoot = (draft: Record<string, unknown>): Record<string, unknown> => {
    if (!recurring || (draft.seriesId !== undefined && draft.seriesId !== null)) return draft;
    return {
      ...draft,
      seriesId: draft.id,
      recurrenceAnchor: draft.recurrenceAnchor ?? draft.dueAt,
      scheduledFor: draft.scheduledFor ?? draft.dueAt,
      occurrenceIndex: draft.occurrenceIndex ?? 0,
    };
  };
  const direct = BillSchema.safeParse(asRoot({ ...raw }));
  if (direct.success) return { record: direct.data, repairs };
  const base = BaseRecordSchema.parse(raw);
  // The lineage fields are repaired individually; the money fields must parse.
  const shape = BillSchema._def.schema.shape;
  const top = repairShape(raw, shape, '', repairs);
  const lineage = [
    'seriesId',
    'recurrenceAnchor',
    'occurrenceIndex',
    'scheduledFor',
    'paidAt',
    'nextBillId',
    'repeatStopped',
  ];
  const bad = repairs.filter((r) => !lineage.includes(r));
  if (bad.length) throw new Error(`The bill record is invalid: ${bad.join(', ')}.`);
  const merged: Record<string, unknown> = asRoot({ ...top, ...base });
  // A lineage that contradicts itself falls back to a one-off or a series root.
  const again = BillSchema.safeParse(merged);
  if (again.success) return { record: again.data, repairs };
  repairs.push('lineage');
  const reset = {
    ...merged,
    seriesId: recurring ? base.id : null,
    recurrenceAnchor: recurring ? merged.dueAt : null,
    occurrenceIndex: 0,
    scheduledFor: recurring ? merged.dueAt : null,
    nextBillId: null,
    paidAt: merged.paid === true ? (merged.paidAt ?? null) : null,
  };
  return { record: BillSchema.parse(reset), repairs };
}
