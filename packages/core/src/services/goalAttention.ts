import type { Area, Goal, Id, Instant, Project, Session, Task } from '../schema';

export interface AttentionInput {
  areas: readonly Area[];
  goals: readonly Goal[];
  projects: readonly Project[];
  tasks: readonly Task[];
  sessions: readonly Session[];
  now: Date;
  /** Rolling window in days. Default 14. */
  windowDays?: number;
}

export interface GoalAttention {
  goalId: Id;
  minutesInWindow: number;
  /** Minutes the goal "should" get in the window, from the area target split across its active goals; null without a target. */
  expectedMinutes: number | null;
  /** minutes / expected, or null without a target. */
  ratio: number | null;
  activeProjects: number;
  openTasks: number;
  lastSessionAt: Instant | null;
  /** Active goal that received no time in the window. */
  neglected: boolean;
}

export interface AreaAttention {
  areaId: Id;
  minutesInWindow: number;
  targetMinutes: number;
  ratio: number | null;
  activeGoals: number;
}

const DAY_MS = 86_400_000;

function sessionMinutes(s: Session, now: Date): number {
  const end = s.endAt ? new Date(s.endAt) : now;
  return Math.max(0, (end.getTime() - new Date(s.startAt).getTime()) / 60_000);
}

/** Minutes per task id from sessions that ended inside the window. */
function minutesByTask(input: AttentionInput): Map<Id, { minutes: number; last: Instant | null }> {
  const windowDays = input.windowDays ?? 14;
  const since = input.now.getTime() - windowDays * DAY_MS;
  const out = new Map<Id, { minutes: number; last: Instant | null }>();
  for (const s of input.sessions) {
    if (s.deletedAt !== null) continue;
    const endAt = s.endAt ?? input.now.toISOString();
    if (new Date(endAt).getTime() < since) continue;
    const cur = out.get(s.taskId) ?? { minutes: 0, last: null };
    cur.minutes += sessionMinutes(s, input.now);
    if (!cur.last || endAt > cur.last) cur.last = endAt;
    out.set(s.taskId, cur);
  }
  return out;
}

export function computeGoalAttention(goal: Goal, input: AttentionInput): GoalAttention {
  const windowDays = input.windowDays ?? 14;
  const projects = input.projects.filter((p) => p.deletedAt === null && p.goalId === goal.id);
  const projectIds = new Set(projects.map((p) => p.id));
  const tasks = input.tasks.filter(
    (t) => t.deletedAt === null && t.projectId && projectIds.has(t.projectId),
  );
  const perTask = minutesByTask(input);

  let minutes = 0;
  let last: Instant | null = null;
  for (const t of tasks) {
    const m = perTask.get(t.id);
    if (!m) continue;
    minutes += m.minutes;
    if (m.last && (!last || m.last > last)) last = m.last;
  }

  const area = input.areas.find((a) => a.id === goal.areaId && a.deletedAt === null);
  const siblings =
    input.goals.filter(
      (g) => g.deletedAt === null && g.areaId === goal.areaId && g.status === 'active',
    ).length || 1;
  const expected =
    area && area.weeklyHoursTarget > 0
      ? (area.weeklyHoursTarget * 60 * (windowDays / 7)) / siblings
      : null;

  return {
    goalId: goal.id,
    minutesInWindow: Math.round(minutes),
    expectedMinutes: expected === null ? null : Math.round(expected),
    ratio: expected ? minutes / expected : null,
    activeProjects: projects.filter((p) => p.status === 'active').length,
    openTasks: tasks.filter((t) => t.status === 'open').length,
    lastSessionAt: last,
    neglected: goal.status === 'active' && minutes === 0,
  };
}

export function computeAreaAttention(area: Area, input: AttentionInput): AreaAttention {
  const windowDays = input.windowDays ?? 14;
  const perTask = minutesByTask(input);
  const projectIds = new Set(
    input.projects.filter((p) => p.deletedAt === null && p.areaId === area.id).map((p) => p.id),
  );
  let minutes = 0;
  for (const t of input.tasks) {
    if (t.deletedAt !== null) continue;
    const inArea =
      (t.projectId && projectIds.has(t.projectId)) || (!t.projectId && t.areaId === area.id);
    if (!inArea) continue;
    minutes += perTask.get(t.id)?.minutes ?? 0;
  }
  const targetMinutes = Math.round(area.weeklyHoursTarget * 60 * (windowDays / 7));
  return {
    areaId: area.id,
    minutesInWindow: Math.round(minutes),
    targetMinutes,
    ratio: targetMinutes > 0 ? minutes / targetMinutes : null,
    activeGoals: input.goals.filter(
      (g) => g.deletedAt === null && g.areaId === area.id && g.status === 'active',
    ).length,
  };
}
