import { normalizeAppSettings, normalizeBill, normalizeInsightState } from '@orbit/core';
import type { BaseRecord } from '@orbit/core';
import type { StoreName } from './repository';

/**
 * Read-boundary normalization (week 11, extended in week 12). Adapters hand
 * back stored JSON as it was written, by whichever build wrote it; for the
 * stores whose shape grew every read runs the core compatibility policy so
 * old rows come back with defaults and malformed values repaired. These
 * stores are small (one settings document, one row per suppressed insight,
 * dozens of bills), so the cost is invisible; the large stores are returned
 * untouched. A bill written before week 12 comes back as its own series
 * root; nothing is generated or advanced on read.
 */
const NORMALIZERS: Partial<Record<StoreName, (raw: unknown) => BaseRecord>> = {
  appSettings: (raw) => normalizeAppSettings(raw).record,
  insightStates: (raw) => normalizeInsightState(raw).record,
  bills: (raw) => normalizeBill(raw).record,
};

export function normalizerFor<T extends BaseRecord>(name: StoreName): ((raw: T) => T) | null {
  const fn = NORMALIZERS[name];
  return fn ? (raw) => fn(raw) as T : null;
}
