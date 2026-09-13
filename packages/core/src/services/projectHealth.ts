import { toLocalDate } from '../dates';
import type { Id, Instant, Milestone, Project, Session, Task } from '../schema';
import { buildProjectActivity, elapsedDays, type ProjectActivity } from './activity';
import { isReady } from './dependencies';

export interface ProjectHealth {
  projectId: Id;
  /** 0..1 */
  progress: number;
  progressSource: 'milestones' | 'tasks' | 'none';
  milestonesDone: number;
  milestonesTotal: number;
  openTasks: number;
  doneTasks: number;
  /** Active project with no valid open next action (including no tasks at all). */
  noNextAction: boolean;
  /** Every open task waits on something. */
  blocked: boolean;
  /** Complete elapsed days since the project, a task, a milestone, or a session last changed. */
  staleDays: number;
  stale: boolean;
  /** The threshold `stale` was judged against. */
  staleAfterDays: number;
  lastActivityAt: Instant | null;
  /** What that last activity was; shared with the stale-project insight. */
  lastActivity: ProjectActivity | null;
  /** Negative when the deadline has passed; null without a deadline. */
  daysToDeadline: number | null;
  overdue: boolean;
}

export interface ProjectHealthInput {
  /** May include tombstones: they count as activity, never as work. */
  milestones: readonly Milestone[];
  /** May include tombstones, as above. */
  tasks: readonly Task[];
  sessions?: readonly Session[];
  now: Date;
  /** Days without activity before a project counts as stale. Default 10. */
  staleAfterDays?: number;
  /**
   * A precomputed activity map from `buildProjectActivity`, so a long list
   * is not scanned once per project. Built for the one project otherwise.
   */
  activity?: ReadonlyMap<Id, ProjectActivity>;
}

export const DEFAULT_STALE_AFTER_DAYS = 10;

const DAY_MS = 86_400_000;

/**
 * Progress from milestones when the project has any; otherwise from task
 * completion; 0 when there is nothing to measure. Also flags the three
 * neglect signals the weekly review and the Today screen surface. The
 * staleness part is the one shared definition (`services/activity.ts`).
 */
export function computeProjectHealth(project: Project, input: ProjectHealthInput): ProjectHealth {
  const staleAfter = input.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
  const ms = input.milestones.filter((m) => m.deletedAt === null && m.projectId === project.id);
  const tasks = input.tasks.filter((t) => t.deletedAt === null && t.projectId === project.id);
  const open = tasks.filter((t) => t.status === 'open' || t.status === 'inbox');
  const done = tasks.filter((t) => t.status === 'done');

  let progress = 0;
  let progressSource: ProjectHealth['progressSource'] = 'none';
  const milestonesDone = ms.filter((m) => m.done).length;
  if (ms.length) {
    progress = milestonesDone / ms.length;
    progressSource = 'milestones';
  } else if (open.length + done.length) {
    progress = done.length / (open.length + done.length);
    progressSource = 'tasks';
  }
  if (project.status === 'completed') progress = 1;

  const next = project.nextActionTaskId
    ? open.find((t) => t.id === project.nextActionTaskId)
    : undefined;
  const noNextAction = project.status === 'active' && !next;
  const blocked = open.length > 0 && open.every((t) => !isReady(t, input.tasks));

  const lastActivity =
    (
      input.activity ??
      buildProjectActivity({
        projects: [project],
        tasks: input.tasks,
        milestones: input.milestones,
        sessions: input.sessions,
      })
    ).get(project.id) ?? null;
  const staleDays = lastActivity ? elapsedDays(lastActivity.at, input.now) : 0;

  let daysToDeadline: number | null = null;
  if (project.deadline) {
    const today = toLocalDate(input.now);
    daysToDeadline = Math.round((Date.parse(project.deadline) - Date.parse(today)) / DAY_MS);
  }

  return {
    projectId: project.id,
    progress,
    progressSource,
    milestonesDone,
    milestonesTotal: ms.length,
    openTasks: open.length,
    doneTasks: done.length,
    noNextAction,
    blocked,
    staleDays,
    stale: project.status === 'active' && staleDays >= staleAfter,
    staleAfterDays: staleAfter,
    lastActivityAt: lastActivity?.at ?? null,
    lastActivity,
    daysToDeadline,
    overdue: project.status === 'active' && daysToDeadline !== null && daysToDeadline < 0,
  };
}
