import { addDays, toLocalDate } from '../dates';
import { subjectsFingerprint } from './weeklyReview';
import type {
  Area,
  Bill,
  Block,
  DailyReflection,
  DayCommitment,
  Id,
  LocalDate,
  Project,
  Session,
  Task,
} from '../schema';

export interface TrendTimeBucket {
  id: Id | null;
  label: string;
  minutes: number;
}

export interface WeeklyTrendReport {
  weekStart: LocalDate;
  weekEnd: LocalDate;
  timerMinutes: number;
  manualMinutes: number;
  actualMinutes: number;
  runningSessions: number;
  plannedMinutes: number;
  byArea: TrendTimeBucket[];
  byProject: TrendTimeBucket[];
  completion: { committed: number; completedSameDay: number; rollovers: number };
  energy: Record<'low' | 'medium' | 'high', number>;
  reflections: {
    days: number;
    moodAverage: number | null;
    stressAverage: number | null;
    sleepAverage: number | null;
    tags: Array<{ tag: string; count: number }>;
  };
  coverage: { completedTasks: number; timedCompletedTasks: number; text: string };
  spending: {
    total: number;
    currency: 'JOD';
    items: Array<{ name: string; count: number; total: number }>;
  };
  fingerprint: string;
}

export interface WeeklyTrendInput {
  areas: readonly Area[];
  projects: readonly Project[];
  tasks: readonly Task[];
  sessions: readonly Session[];
  blocks: readonly Block[];
  commitments: readonly DayCommitment[];
  reflections: readonly DailyReflection[];
  bills?: readonly Bill[];
}

function localStart(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getTime();
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

/**
 * Derive weekly observations without mutating or interpreting journal prose.
 * Closed sessions are clipped to the week. A completed task's manual actual is
 * used only when that task has no closed session in the selected week.
 */
export function buildWeeklyTrendReport(
  weekStart: LocalDate,
  input: WeeklyTrendInput,
): WeeklyTrendReport {
  const weekEnd = addDays(weekStart, 6);
  const startMs = localStart(weekStart);
  const endMs = localStart(addDays(weekStart, 7));
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  const projectById = new Map(input.projects.map((project) => [project.id, project]));
  const areaById = new Map(input.areas.map((area) => [area.id, area]));
  const sessionMinutes = new Map<Id, number>();
  const tasksWithAnyClosedSession = new Set<Id>();
  let runningSessions = 0;
  for (const session of input.sessions) {
    if (session.deletedAt !== null) continue;
    if (session.endAt !== null) tasksWithAnyClosedSession.add(session.taskId);
    if (session.endAt === null) {
      if (new Date(session.startAt).getTime() < endMs) runningSessions += 1;
      continue;
    }
    const start = Math.max(startMs, new Date(session.startAt).getTime());
    const end = Math.min(endMs, new Date(session.endAt).getTime());
    if (end <= start) continue;
    const minutes = Math.round((end - start) / 60_000);
    sessionMinutes.set(session.taskId, (sessionMinutes.get(session.taskId) ?? 0) + minutes);
  }

  const completed = input.tasks.filter((task) => {
    if (task.deletedAt !== null || task.status !== 'done' || !task.completedAt) return false;
    const at = new Date(task.completedAt).getTime();
    return at >= startMs && at < endMs;
  });
  let manualMinutes = 0;
  const actualByTask = new Map(sessionMinutes);
  for (const task of completed) {
    if (!tasksWithAnyClosedSession.has(task.id) && task.actualMin !== null) {
      actualByTask.set(task.id, task.actualMin);
      manualMinutes += task.actualMin;
    }
  }
  const timerMinutes = [...sessionMinutes.values()].reduce((sum, value) => sum + value, 0);

  const bucket = (kind: 'area' | 'project') => {
    const totals = new Map<Id | null, number>();
    for (const [taskId, minutes] of actualByTask) {
      const task = taskById.get(taskId);
      const id =
        kind === 'project'
          ? (task?.projectId ?? null)
          : (task?.areaId ??
            (task?.projectId ? projectById.get(task.projectId)?.areaId : null) ??
            null);
      totals.set(id, (totals.get(id) ?? 0) + minutes);
    }
    return [...totals.entries()]
      .map(([id, minutes]) => ({
        id,
        minutes,
        label:
          id === null
            ? 'Unassigned'
            : kind === 'project'
              ? (projectById.get(id)?.title ?? 'Unknown project')
              : (areaById.get(id)?.name ?? 'Unknown area'),
      }))
      .sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label));
  };

  const blocks = input.blocks.filter(
    (block) =>
      block.deletedAt === null &&
      block.taskId !== null &&
      block.date >= weekStart &&
      block.date <= weekEnd,
  );
  const plannedMinutes = blocks.reduce((sum, block) => sum + (block.endMin - block.startMin), 0);
  const commitments = input.commitments.filter(
    (item) => item.deletedAt === null && item.date >= weekStart && item.date <= weekEnd,
  );
  let committed = 0;
  let completedSameDay = 0;
  for (const item of commitments) {
    for (const taskId of item.acceptedTaskIds) {
      committed += 1;
      const completedAt = taskById.get(taskId)?.completedAt;
      if (completedAt && toLocalDate(new Date(completedAt)) === item.date) completedSameDay += 1;
    }
  }
  const energy = { low: 0, medium: 0, high: 0 };
  for (const item of commitments) energy[item.energy] += 1;

  const reflections = input.reflections.filter(
    (item) => item.deletedAt === null && item.date >= weekStart && item.date <= weekEnd,
  );
  const tags = new Map<string, number>();
  for (const reflection of reflections)
    for (const tag of reflection.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  const timedCompletedTasks = completed.filter(
    (task) => tasksWithAnyClosedSession.has(task.id) || task.actualMin !== null,
  ).length;

  const spendingItems = new Map<string, { name: string; count: number; total: number }>();
  const expenses = (input.bills ?? []).filter(
    (item) =>
      item.kind === 'expense' &&
      item.deletedAt === null &&
      item.currency === 'JOD' &&
      item.dueAt !== null &&
      item.dueAt >= weekStart &&
      item.dueAt <= weekEnd,
  );
  for (const expense of expenses) {
    const key = expense.title.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    const current = spendingItems.get(key);
    if (current) {
      current.count += 1;
      current.total += expense.amount;
    } else {
      spendingItems.set(key, {
        name: key.replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase()),
        count: 1,
        total: expense.amount,
      });
    }
  }

  return {
    weekStart,
    weekEnd,
    timerMinutes,
    manualMinutes,
    actualMinutes: timerMinutes + manualMinutes,
    runningSessions,
    plannedMinutes,
    byArea: bucket('area'),
    byProject: bucket('project'),
    completion: {
      committed,
      completedSameDay,
      rollovers: Math.max(0, committed - completedSameDay),
    },
    energy,
    reflections: {
      days: reflections.length,
      moodAverage: average(reflections.map((item) => item.mood)),
      stressAverage: average(reflections.map((item) => item.stress)),
      sleepAverage: average(reflections.map((item) => item.sleepQuality)),
      tags: [...tags.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    },
    coverage: {
      completedTasks: completed.length,
      timedCompletedTasks,
      text: `${timedCompletedTasks} of ${completed.length} completed tasks have recorded time.`,
    },
    spending: {
      total: expenses.reduce((sum, item) => sum + item.amount, 0),
      currency: 'JOD',
      items: [...spendingItems.values()].sort(
        (a, b) => b.total - a.total || a.name.localeCompare(b.name),
      ),
    },
    fingerprint: subjectsFingerprint([
      ...input.sessions,
      ...completed,
      ...blocks,
      ...commitments,
      ...reflections,
      ...expenses,
    ]),
  };
}
