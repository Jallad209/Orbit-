import type { Clock } from '../clock';
import { addDays, toLocalDate } from '../dates';
import { createRecord } from '../records';
import { RoutineInstanceSchema } from '../schema';
import type { Id, LocalDate, Routine, RoutineInstance, Rule } from '../schema';
import { expandRecurrence, startOfWeek, type DateRange } from './expand';

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

/**
 * "Schedule exercise three times per week": the first typed rule. For the
 * week containing `date`, count the routine's live instances; if fewer than
 * `timesPerWeek`, add instances on free days, spread evenly from today
 * onwards. Days before `date` are never filled.
 */
export function applyRecurringRules(
  rules: readonly Rule[],
  routines: readonly Routine[],
  existing: readonly RoutineInstance[],
  date: LocalDate,
  clock: Clock,
): RoutineInstance[] {
  const byId = new Map<Id, Routine>(
    routines.filter((r) => r.deletedAt === null).map((r) => [r.id, r]),
  );
  const weekStart = startOfWeek(date);
  const weekEnd = addDays(weekStart, 6);
  const out: RoutineInstance[] = [];
  for (const rule of rules) {
    if (rule.deletedAt !== null || !rule.enabled || rule.type !== 'recurring') continue;
    const routine = byId.get(rule.config.routineId);
    if (!routine) continue;
    const thisWeek = existing.filter(
      (i) =>
        i.routineId === routine.id &&
        i.deletedAt === null &&
        i.date >= weekStart &&
        i.date <= weekEnd,
    );
    const taken = new Set(thisWeek.map((i) => i.date));
    const missing = rule.config.timesPerWeek - thisWeek.length;
    if (missing <= 0) continue;
    const candidates: LocalDate[] = [];
    for (let d = date; d <= weekEnd; d = addDays(d, 1)) if (!taken.has(d)) candidates.push(d);
    // Spread: pick every k-th free day so the instances are not bunched.
    const step = Math.max(1, Math.floor(candidates.length / missing));
    for (let i = 0, n = 0; i < candidates.length && n < missing; i += step, n++) {
      out.push(
        createRecord(RoutineInstanceSchema, clock, { routineId: routine.id, date: candidates[i]! }),
      );
    }
  }
  return out;
}
