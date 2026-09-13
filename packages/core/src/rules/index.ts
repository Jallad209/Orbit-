import type { Clock } from '../clock';
import type {
  Bill,
  Commitment,
  LocalDate,
  Person,
  Reminder,
  Routine,
  RoutineInstance,
  Rule,
} from '../schema';
import { detectConflicts, type RuleConflict } from './conflicts';
import { applyRecurringRules } from './recurring';
import { computeReminders, reconcileReminders, type ReminderDraft } from './reminders';

export * from './constraints';
export * from './recurring';
export * from './rollover';
export * from './reminders';
export * from './conflicts';

/**
 * The four rule families are structured objects, never parsed sentences:
 * constraints shape capacity (applied inside the planner), recurring rules
 * add routine instances, the rollover policy steers the evening review, and
 * reminder rules queue notifications. `evaluateRules` runs the parts that
 * produce records in one pass.
 */
export interface RulesSnapshot {
  rules: readonly Rule[];
  routines?: readonly Routine[];
  routineInstances?: readonly RoutineInstance[];
  bills?: readonly Bill[];
  commitments?: readonly Commitment[];
  people?: readonly Person[];
  reminders?: readonly Reminder[];
}

export interface RuleEvaluation {
  /** Routine instances to create for the week of `date`. */
  routineInstances: RoutineInstance[];
  /** Reminders that should exist and do not yet. */
  reminders: ReminderDraft[];
  conflicts: RuleConflict[];
}

export function evaluateRules(
  snapshot: RulesSnapshot,
  date: LocalDate,
  clock: Clock,
): RuleEvaluation {
  return {
    routineInstances: applyRecurringRules(
      snapshot.rules,
      snapshot.routines ?? [],
      snapshot.routineInstances ?? [],
      date,
      clock,
    ),
    reminders: reconcileReminders(
      snapshot.reminders ?? [],
      computeReminders(snapshot, clock.now()),
    ),
    conflicts: detectConflicts(snapshot.rules),
  };
}
