import type { Clock } from '../clock';
import { addDays } from '../dates';
import { createRecord } from '../records';
import { startOfWeek } from '../recurrence/expand';
import { RoutineInstanceSchema } from '../schema';
import type { Id, LocalDate, Routine, RoutineInstance, Rule } from '../schema';

/** Enabled, live recurring rules. */
export function recurringRules(rules: readonly Rule[]) {
  return rules.filter(
    (r): r is Extract<Rule, { type: 'recurring' }> =>
      r.deletedAt === null && r.enabled && r.type === 'recurring',
  );
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
  for (const rule of recurringRules(rules)) {
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
