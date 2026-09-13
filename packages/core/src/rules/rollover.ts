import type { Clock } from '../clock';
import { addDays, minuteOfDay, toInstant, toLocalDate } from '../dates';
import { startOfWeek } from '../recurrence/expand';
import type { Id, LocalDate, RolloverConfig, RolloverTarget, Rule, Task } from '../schema';
import { TaskSchema } from '../schema';
import { rulesInOrder } from './order';

/**
 * What happens to unfinished committed work at the end of the day. The
 * `rollover` rule family maps priority → target; the evening review
 * suggests from it and the user confirms per task.
 */

export const DEFAULT_ROLLOVER: RolloverConfig = { p1: 'tomorrow', p2: 'tomorrow', p3: 'nextWeek' };

/** A date-only due is 23:59 local, matching capture. */
const END_OF_DAY = 23 * 60 + 59;

/** The enabled rollover rule's config, or the default when none is set. */
export function rolloverPolicy(rules: readonly Rule[] = []): RolloverConfig {
  for (const r of rulesInOrder(rules)) {
    if (r.deletedAt === null && r.enabled && r.type === 'rollover') return r.config;
  }
  return DEFAULT_ROLLOVER;
}

export function suggestRollover(task: Task, rules: readonly Rule[] = []): RolloverTarget {
  const policy = rolloverPolicy(rules);
  return task.priority === 1 ? policy.p1 : task.priority === 2 ? policy.p2 : policy.p3;
}

export interface RolloverChoice {
  taskId: Id;
  target: RolloverTarget;
}

/** The Monday after `date` (next week's start), never `date` itself. */
export function nextMonday(date: LocalDate): LocalDate {
  return addDays(startOfWeek(date), 7);
}

/** Where a target lands, relative to the day being closed. */
export function rolloverDate(target: RolloverTarget, today: LocalDate): LocalDate | null {
  if (target === 'tomorrow') return addDays(today, 1);
  if (target === 'nextWeek') return nextMonday(today);
  return null;
}

/**
 * Apply the user's choices. Tomorrow and next week move the due date,
 * keeping the task's own time of day when it had one; inbox sends the task
 * back to triage with no due date. Returns only the tasks that changed.
 */
export function applyRollover(
  choices: readonly RolloverChoice[],
  tasks: readonly Task[],
  clock: Clock,
): Task[] {
  const today = toLocalDate(clock.now());
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: Task[] = [];
  for (const choice of choices) {
    const task = byId.get(choice.taskId);
    if (!task || task.deletedAt !== null) continue;
    if (choice.target === 'inbox') {
      out.push(TaskSchema.parse({ ...task, status: 'inbox', dueAt: null }));
      continue;
    }
    const date = rolloverDate(choice.target, today)!;
    const minute = task.dueAt ? minuteOfDay(new Date(task.dueAt)) : END_OF_DAY;
    out.push(
      TaskSchema.parse({
        ...task,
        status: task.status === 'inbox' ? 'open' : task.status,
        dueAt: toInstant(date, minute).toISOString(),
      }),
    );
  }
  return out;
}
