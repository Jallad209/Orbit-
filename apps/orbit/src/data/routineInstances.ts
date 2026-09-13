import {
  applyRecurringRules,
  instanceWindow,
  materializeInstances,
  systemClock,
  toLocalDate,
  type Clock,
} from '@orbit/core';
import type { Repository } from '@orbit/storage';

const pending = new WeakMap<Repository, Promise<number>>();

/** Keep the rolling window ready before any screen builds a plan. */
export async function ensureRoutineInstances(
  repo: Repository,
  clock: Clock = systemClock,
): Promise<number> {
  // Concurrent screen loads must not create two instances for the same occurrence.
  const previous = pending.get(repo);
  const work = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const [routines, instances, rules] = await Promise.all([
        repo.routines.list(),
        repo.routineInstances.list({ includeDeleted: true }),
        repo.rules.list(),
      ]);
      const fresh = materializeInstances(routines, instances, instanceWindow(clock.now()), clock);
      const fromRules = applyRecurringRules(
        rules,
        routines,
        [...instances, ...fresh],
        toLocalDate(clock.now()),
        clock,
      );
      const all = [...fresh, ...fromRules];
      if (all.length) {
        await repo.transaction(async (tx) => {
          for (const instance of all) await tx.routineInstances.upsert(instance);
        });
      }
      return all.length;
    });
  pending.set(repo, work);
  try {
    return await work;
  } finally {
    if (pending.get(repo) === work) pending.delete(repo);
  }
}
