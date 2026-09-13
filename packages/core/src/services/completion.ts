import type { Clock } from '../clock';
import { nowIso } from '../clock';
import type { Id, Project, Session, Task } from '../schema';
import { TaskSchema } from '../schema';
import { hasSession, taskSessionMinutes } from './sessions';
import { areaOfTask } from './timeByArea';

/**
 * Completing a task records what it actually took. With a timer the
 * sessions say; without one the caller passes the minutes the user typed,
 * or null to leave it for the evening review to ask.
 */

const DAY_MS = 86_400_000;

/**
 * Mark a task done. When `actualMin` is null the task's sessions fill it
 * in; with no sessions it stays null so the evening review can prompt.
 */
export function completeTask(
  task: Task,
  actualMin: number | null,
  sessions: readonly Session[],
  clock: Clock,
): Task {
  const now = clock.now();
  let actual = actualMin;
  if (actual === null && hasSession(task.id, sessions)) {
    actual = Math.round(taskSessionMinutes(task.id, sessions, now));
  }
  return TaskSchema.parse({
    ...task,
    status: 'done',
    actualMin: actual === null ? null : Math.max(0, Math.round(actual)),
    completedAt: nowIso(clock),
  });
}

/** Done tasks with no recorded actual and no session: the evening review asks about these. */
export function needsActual(tasks: readonly Task[], sessions: readonly Session[]): Task[] {
  return tasks.filter(
    (t) =>
      t.deletedAt === null &&
      t.status === 'done' &&
      t.actualMin === null &&
      !hasSession(t.id, sessions),
  );
}

export interface EstimateAccuracy {
  /** null = tasks with no area. */
  areaId: Id | null;
  /** Completed tasks in the window with both an estimate and an actual. */
  tasks: number;
  estimateMin: number;
  actualMin: number;
  /** actual ÷ estimate; 1 = spot on, 2 = took twice as long; null with nothing to measure. */
  ratio: number | null;
}

export interface EstimateAccuracyInput {
  tasks: readonly Task[];
  sessions?: readonly Session[];
  projects?: readonly Project[];
}

/**
 * How estimates compare with reality, per area, over the last `windowDays`.
 * A computed value, not a stored one: completing a task with an actual
 * changes the next call's answer. Tasks completed with sessions but no
 * `actualMin` fall back to their session minutes.
 */
export function estimateAccuracy(
  input: EstimateAccuracyInput,
  windowDays: number,
  clock: Clock,
): EstimateAccuracy[] {
  const now = clock.now();
  const since = now.getTime() - windowDays * DAY_MS;
  const sessions = input.sessions ?? [];
  const projectById = new Map((input.projects ?? []).map((p) => [p.id, p]));
  const byArea = new Map<Id | null, EstimateAccuracy>();
  for (const t of input.tasks) {
    if (t.deletedAt !== null || t.status !== 'done' || !t.completedAt) continue;
    if (new Date(t.completedAt).getTime() < since) continue;
    if (t.estimateMin <= 0) continue;
    const actual =
      t.actualMin ??
      (hasSession(t.id, sessions) ? Math.round(taskSessionMinutes(t.id, sessions, now)) : null);
    if (actual === null) continue;
    const areaId = areaOfTask(t, projectById);
    const row = byArea.get(areaId) ?? {
      areaId,
      tasks: 0,
      estimateMin: 0,
      actualMin: 0,
      ratio: null,
    };
    row.tasks += 1;
    row.estimateMin += t.estimateMin;
    row.actualMin += actual;
    byArea.set(areaId, row);
  }
  // Busiest area first; tasks with no area last.
  return [...byArea.values()]
    .map((r) => ({ ...r, ratio: r.estimateMin > 0 ? r.actualMin / r.estimateMin : null }))
    .sort(
      (a, b) =>
        b.tasks - a.tasks ||
        Number(a.areaId === null) - Number(b.areaId === null) ||
        (a.areaId ?? '').localeCompare(b.areaId ?? ''),
    );
}
