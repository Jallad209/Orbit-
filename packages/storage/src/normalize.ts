import { normalizeAppSettings, normalizeInsightState } from '@orbit/core';
import type { BaseRecord } from '@orbit/core';
import type { StoreName } from './repository';

/**
 * Read-boundary normalization (week 11). Adapters hand back stored JSON as
 * it was written, by whichever build wrote it; for the two stores whose
 * shape grew in week 11 every read runs the core compatibility policy so
 * old rows come back with defaults and malformed values repaired. Both
 * stores are tiny (one settings document, one row per suppressed insight),
 * so the cost is invisible; the large stores are returned untouched.
 */
const NORMALIZERS: Partial<Record<StoreName, (raw: unknown) => BaseRecord>> = {
  appSettings: (raw) => normalizeAppSettings(raw).record,
  insightStates: (raw) => normalizeInsightState(raw).record,
};

export function normalizerFor<T extends BaseRecord>(name: StoreName): ((raw: T) => T) | null {
  const fn = NORMALIZERS[name];
  return fn ? (raw) => fn(raw) as T : null;
}
