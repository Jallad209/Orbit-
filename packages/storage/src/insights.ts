import { canonicalState, systemClock } from '@orbit/core';
import type { Clock, InsightState } from '@orbit/core';
import type { Repository } from './repository';

/**
 * Insight suppression writes (week 11). One owned transaction per action:
 * the current rows for the key are re-read inside it, so two windows
 * snoozing and dismissing the same key cannot overwrite each other's newer
 * change — the last committed action wins, and it wins over a state it
 * actually saw. Legacy or imported duplicates for one key are merged into
 * the canonical row (newest `updatedAt`, then smallest id) and the rest
 * retired in the same transaction. The callback never touches the root
 * repository: it gets the transaction's view only.
 */

export interface InsightStateWrite {
  state: InsightState;
  /** Duplicate rows retired alongside the write. */
  retired: number;
}

export async function writeInsightState(
  repo: Repository,
  key: string,
  update: (current: InsightState | undefined) => InsightState | null,
  clock: Clock = systemClock,
): Promise<InsightStateWrite | null> {
  return repo.transaction(async (tx) => {
    const rows = await tx.insightStates.query((s) => s.insightKey === key, {
      includeDeleted: true,
    });
    const current = canonicalState(rows);
    const next = update(current);
    if (next === null) return null;
    if (next.insightKey !== key) throw new Error('An insight state keeps its key.');
    let retired = 0;
    for (const row of rows) {
      if (row.deletedAt === null && row.id !== next.id) {
        await tx.insightStates.softDelete(row.id);
        retired += 1;
      }
    }
    const state = await tx.insightStates.upsert({
      ...next,
      updatedAt: clock.now().toISOString(),
    });
    return { state, retired };
  });
}

/** Every live state row, one per key, duplicates resolved the same way the writer does. */
export async function readInsightStates(repo: Repository): Promise<InsightState[]> {
  const rows = await repo.insightStates.list();
  const byKey = new Map<string, InsightState[]>();
  for (const r of rows) {
    const list = byKey.get(r.insightKey);
    if (list) list.push(r);
    else byKey.set(r.insightKey, [r]);
  }
  const out: InsightState[] = [];
  for (const list of byKey.values()) {
    const chosen = canonicalState(list);
    if (chosen) out.push(chosen);
  }
  return out.sort((a, b) =>
    a.insightKey < b.insightKey ? -1 : a.insightKey > b.insightKey ? 1 : 0,
  );
}
