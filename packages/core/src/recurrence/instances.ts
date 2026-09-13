import type { Clock } from '../clock';
import { addDays, toLocalDate } from '../dates';
import { createRecord } from '../records';
import { RoutineInstanceSchema } from '../schema';
import type { LocalDate, Routine, RoutineInstance } from '../schema';
import { expandRecurrence, type DateRange } from './expand';

/** The rolling window instances are kept materialized for. */
export const INSTANCE_WINDOW_DAYS = 28;

export function instanceWindow(now: Date): DateRange {
  const today = toLocalDate(now);
  return { from: today, to: addDays(today, INSTANCE_WINDOW_DAYS - 1) };
}

export function routineAnchor(routine: Routine): LocalDate {
  return routine.startDate ?? toLocalDate(new Date(routine.createdAt));
}

/**
 * Instances to create so every occurrence in the window has one. A date that
 * already has an instance, whatever its status (done, skipped, even soft
 * deleted), is an exception and is never regenerated.
 */
export function materializeInstances(
  routines: readonly Routine[],
  existing: readonly RoutineInstance[],
  range: DateRange,
  clock: Clock,
): RoutineInstance[] {
  const have = new Set(existing.map((i) => `${i.routineId}:${i.date}`));
  const out: RoutineInstance[] = [];
  for (const routine of routines) {
    if (routine.deletedAt !== null) continue;
    for (const date of expandRecurrence(routine.recurrence, routineAnchor(routine), range)) {
      const key = `${routine.id}:${date}`;
      if (have.has(key)) continue;
      have.add(key);
      out.push(createRecord(RoutineInstanceSchema, clock, { routineId: routine.id, date }));
    }
  }
  return out;
}

export function markInstance(
  instance: RoutineInstance,
  status: RoutineInstance['status'],
): RoutineInstance {
  return { ...instance, status };
}
