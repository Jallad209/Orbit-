import { addDays, toLocalDate } from '../dates';
import type { Id, LocalDate, Milestone, Project, Session, Task } from '../schema';
import type { ProjectActivity } from './activity';
import { computeProjectHealth, type ProjectHealth } from './projectHealth';

/**
 * What is slipping. One rule shared by the Today screen and the morning
 * briefing: overdue tasks, tasks due soon that have no block on the day,
 * and active projects with a deadline within a week and under half done.
 */

export interface AtRiskInput {
  tasks: readonly Task[];
  projects: readonly Project[];
  milestones?: readonly Milestone[];
  sessions?: readonly Session[];
  /** Tasks that already have a block on the day; a due-soon task with one is not at risk. */
  plannedTaskIds?: ReadonlySet<Id>;
  now: Date;
  /** Shared staleness threshold and activity map, so the health here matches every other surface. */
  staleAfterDays?: number;
  activity?: ReadonlyMap<Id, ProjectActivity>;
}

export interface AtRiskOptions {
  /** Days ahead a due date counts as soon. Default 3. */
  dueSoonDays?: number;
  /** Days ahead a project deadline counts as near. Default 7. */
  deadlineDays?: number;
  /** Progress below which a near-deadline project is at risk. Default 0.5. */
  progressBelow?: number;
}

export interface AtRisk {
  overdue: Task[];
  dueSoon: Task[];
  projects: Array<{ project: Project; health: ProjectHealth }>;
}

function dueDate(task: Task): LocalDate | null {
  return task.dueAt ? toLocalDate(new Date(task.dueAt)) : null;
}

function byDue(a: Task, b: Task): number {
  return a.dueAt! < b.dueAt! ? -1 : a.dueAt! > b.dueAt! ? 1 : 0;
}

export function computeAtRisk(
  input: AtRiskInput,
  date: LocalDate,
  options: AtRiskOptions = {},
): AtRisk {
  const dueSoonDays = options.dueSoonDays ?? 3;
  const deadlineDays = options.deadlineDays ?? 7;
  const progressBelow = options.progressBelow ?? 0.5;
  const planned = input.plannedTaskIds ?? new Set<Id>();
  const open = input.tasks.filter((t) => t.deletedAt === null && t.status === 'open');
  const soonLimit = addDays(date, dueSoonDays);

  const overdue = open
    .filter((t) => {
      const d = dueDate(t);
      return d !== null && d < date;
    })
    .sort(byDue);
  const dueSoon = open
    .filter((t) => {
      const d = dueDate(t);
      return d !== null && d >= date && d <= soonLimit && !planned.has(t.id);
    })
    .sort(byDue);

  const projects = input.projects
    .filter((p) => p.deletedAt === null && p.status === 'active')
    .map((project) => ({
      project,
      health: computeProjectHealth(project, {
        milestones: input.milestones ?? [],
        tasks: input.tasks,
        sessions: input.sessions,
        now: input.now,
        staleAfterDays: input.staleAfterDays,
        activity: input.activity,
      }),
    }))
    .filter(
      ({ health }) =>
        health.daysToDeadline !== null &&
        health.daysToDeadline <= deadlineDays &&
        health.progress < progressBelow,
    )
    .sort((a, b) => a.health.daysToDeadline! - b.health.daysToDeadline!);

  return { overdue, dueSoon, projects };
}
