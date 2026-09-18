import { applyRollover, buildEvening, buildMorning, systemClock } from '@orbit/core';
import type {
  Area,
  Clock,
  DayCommitment,
  EveningReview,
  Id,
  LocalDate,
  MorningBriefing,
  PlanSettings,
  Project,
  RolloverChoice,
  Task,
} from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { ensureRoutineInstances } from '@/data/routineInstances';
import { bumpData } from '@/data/useQuery';

/** Both flows resolve areas and projects by id for display. */
interface Lookups {
  areaById: Map<Id, Area>;
  projectById: Map<Id, Project>;
}

export interface MorningData extends MorningBriefing, Lookups {
  /** Set when the day was already accepted; the flow then offers to re-plan. */
  commitment: DayCommitment | null;
}

export interface LoadMorningOptions {
  date: LocalDate;
  settings: Partial<PlanSettings>;
  clock?: Clock;
}

export async function loadMorning(
  repo: Repository,
  options: LoadMorningOptions,
): Promise<MorningData> {
  const clock = options.clock ?? systemClock;
  await ensureRoutineInstances(repo, clock);
  const { date } = options;
  const [
    areas,
    goals,
    projects,
    tasks,
    events,
    routines,
    routineInstances,
    blocks,
    sessions,
    rules,
    milestones,
    bills,
    dayCommitments,
  ] = await Promise.all([
    repo.areas.list(),
    repo.goals.list(),
    repo.projects.list(),
    repo.tasks.list(),
    repo.events.list(),
    repo.routines.list(),
    repo.routineInstances.list(),
    repo.blocks.list(),
    repo.sessions.list(),
    repo.rules.list(),
    repo.milestones.list(),
    repo.bills.list(),
    repo.dayCommitments.query((c) => c.date === date),
  ]);
  const briefing = buildMorning(
    {
      areas,
      goals,
      projects,
      tasks,
      events,
      routines,
      routineInstances,
      blocks,
      sessions,
      rules,
      milestones,
      bills,
    },
    date,
    options.settings,
    clock,
  );
  return {
    ...briefing,
    commitment: dayCommitments[0] ?? null,
    areaById: new Map(areas.map((a) => [a.id, a])),
    projectById: new Map(projects.map((p) => [p.id, p])),
  };
}

export interface EveningData extends EveningReview, Lookups {}

export async function loadEvening(
  repo: Repository,
  date: LocalDate,
  clock: Clock = systemClock,
): Promise<EveningData> {
  const [areas, projects, tasks, sessions, rules, dayCommitments] = await Promise.all([
    repo.areas.list(),
    repo.projects.list(),
    repo.tasks.list(),
    repo.sessions.list(),
    repo.rules.list(),
    repo.dayCommitments.query((c) => c.date === date),
  ]);
  const review = buildEvening({ tasks, sessions, dayCommitments, projects, rules }, date, clock);
  return {
    ...review,
    areaById: new Map(areas.map((a) => [a.id, a])),
    projectById: new Map(projects.map((p) => [p.id, p])),
  };
}

export interface EveningSubmission {
  /** Actual minutes for tasks completed without a timer. */
  actuals: Array<{ taskId: Id; actualMin: number }>;
  rollover: RolloverChoice[];
}

export interface EveningResult {
  /** Tasks whose actual was recorded. */
  actuals: Task[];
  /** Tasks moved by rollover, as stored. */
  rolled: Task[];
}

/** Write the whole shutdown in one transaction: nothing half-applied if a write fails. */
export async function submitEvening(
  repo: Repository,
  submission: EveningSubmission,
  clock: Clock = systemClock,
): Promise<EveningResult> {
  const ids = new Set([
    ...submission.actuals.map((a) => a.taskId),
    ...submission.rollover.map((r) => r.taskId),
  ]);
  const tasks = await repo.tasks.getMany([...ids]);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const result = await repo.transaction(async (tx) => {
    const actuals: Task[] = [];
    for (const { taskId, actualMin } of submission.actuals) {
      const task = byId.get(taskId);
      if (!task || task.deletedAt !== null) continue;
      const next = await tx.tasks.upsert({
        ...task,
        actualMin: Math.max(0, Math.round(actualMin)),
      });
      byId.set(taskId, next);
      actuals.push(next);
    }
    const rolled: Task[] = [];
    for (const task of applyRollover(submission.rollover, [...byId.values()], clock)) {
      rolled.push(await tx.tasks.upsert(task));
    }
    return { actuals, rolled };
  });
  bumpData();
  return result;
}
