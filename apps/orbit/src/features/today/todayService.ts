import {
  activeSession,
  addDays,
  buildProjectActivity,
  buildProjectHealthIndex,
  computeAtRisk,
  computeProjectHealth,
  localRange,
  materializePlan,
  minuteOfDay,
  planDay,
  systemClock,
  timeByArea as computeTimeByArea,
  toLocalDate,
  trailingRange,
} from '@orbit/core';
import type {
  Area,
  AtRisk,
  Block,
  Clock,
  Commitment,
  DayCommitment,
  Goal,
  Id,
  LocalDate,
  Person,
  PlanProposal,
  PlanSettings,
  Project,
  ProjectHealth,
  ProposedBlock,
  Session,
  Task,
  TimeWindow,
} from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { bumpData } from '@/data/useQuery';
import { ensureRoutineInstances } from '@/data/routineInstances';
import { readSettings } from '@/features/settings/settingsService';

export interface TodayData {
  date: LocalDate;
  now: Date;
  isToday: boolean;
  proposal: PlanProposal;
  /** The stored commitment for the date, when the plan was accepted. */
  commitment: DayCommitment | null;
  /** Stored blocks and events for the date, for the committed view. */
  timeline: ProposedBlock[];
  taskById: Map<Id, Task>;
  projectById: Map<Id, Project>;
  areaById: Map<Id, Area>;
  goalById: Map<Id, Goal>;
  atRisk: AtRisk;
  /** Sessions over the last seven local days, split at midnight, by area. */
  timeByArea: Array<{ area: Area | null; minutes: number }>;
  upcomingCommitments: Array<{ commitment: Commitment; person: Person | undefined }>;
  activeProjects: Array<{ project: Project; health: ProjectHealth }>;
  runningSession: Session | null;
}

export interface LoadTodayOptions {
  date: LocalDate;
  settings: Partial<PlanSettings>;
  clock?: Clock;
}

const DAY_MS = 86_400_000;

/** After the working window has ended, the screen plans tomorrow. */
export function defaultPlanDate(now: Date, window: TimeWindow): LocalDate {
  const today = toLocalDate(now);
  return minuteOfDay(now) >= window.endMin - 30 ? addDays(today, 1) : today;
}

export async function loadToday(repo: Repository, options: LoadTodayOptions): Promise<TodayData> {
  const clock = options.clock ?? systemClock;
  await ensureRoutineInstances(repo, clock);
  const now = clock.now();
  const { date } = options;
  const [
    areas,
    goals,
    projects,
    allTasks,
    events,
    routines,
    routineInstances,
    blocks,
    sessions,
    rules,
    allMilestones,
    commitments,
    people,
    dayCommitments,
    appSettings,
  ] = await Promise.all([
    repo.areas.list(),
    repo.goals.list(),
    repo.projects.list(),
    // Tombstones count as project activity (the shared staleness definition), nothing else.
    repo.tasks.list({ includeDeleted: true }),
    repo.events.list(),
    repo.routines.list(),
    repo.routineInstances.list(),
    repo.blocks.list(),
    repo.sessions.list(),
    repo.rules.list(),
    repo.milestones.list({ includeDeleted: true }),
    repo.commitments.list(),
    repo.people.list(),
    repo.dayCommitments.query((c) => c.date === date),
    readSettings(repo, clock),
  ]);
  const tasks = allTasks.filter((t) => t.deletedAt === null);
  const milestones = allMilestones.filter((m) => m.deletedAt === null);

  const snapshot = {
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
  };
  const proposal = planDay(snapshot, date, options.settings, clock);

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const routineTitle = new Map(routines.map((r) => [r.id, r.title]));
  const instanceRoutine = new Map(routineInstances.map((i) => [i.id, i.routineId]));

  const timeline: ProposedBlock[] = blocks
    .filter((b) => b.date === date)
    .map((b) => ({
      key: `${b.id}#stored`,
      kind: b.locked || b.source === 'manual' ? 'fixed' : b.routineInstanceId ? 'routine' : 'task',
      startMin: b.startMin,
      endMin: b.endMin,
      title: b.taskId
        ? (taskById.get(b.taskId)?.title ?? 'Task')
        : b.routineInstanceId
          ? (routineTitle.get(instanceRoutine.get(b.routineInstanceId) ?? '') ?? 'Routine')
          : 'Block',
      taskId: b.taskId,
      routineInstanceId: b.routineInstanceId,
      eventId: b.eventId,
      locked: b.locked,
      part: null,
      existingBlockId: b.id,
    }));
  for (const e of events) {
    const r = localRange(e.startAt, e.endAt, date);
    if (!r) continue;
    timeline.push({
      key: `${e.id}#event`,
      kind: 'event',
      ...r,
      title: e.title,
      taskId: null,
      routineInstanceId: null,
      eventId: e.id,
      locked: true,
      part: null,
      existingBlockId: null,
    });
  }
  timeline.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  // At risk: the shared rule, with anything blocked on the day counting as planned.
  const plannedToday = new Set(
    [...proposal.blocks, ...timeline].map((b) => b.taskId).filter((id): id is Id => !!id),
  );
  // One activity map and one threshold for every health consumer on the screen.
  const staleAfterDays = appSettings.insights.staleProjectDays;
  const activity = buildProjectActivity({
    projects,
    tasks: allTasks,
    milestones: allMilestones,
    sessions,
  });
  const healthIndex = buildProjectHealthIndex(allTasks, allMilestones);
  const atRisk = computeAtRisk(
    {
      tasks,
      projects,
      milestones,
      sessions,
      plannedTaskIds: plannedToday,
      now,
      staleAfterDays,
      activity,
      healthIndex,
    },
    date,
  );
  const health = new Map(
    projects.map((p) => [
      p.id,
      computeProjectHealth(p, {
        milestones,
        tasks,
        sessions,
        now,
        staleAfterDays,
        activity,
        index: healthIndex,
      }),
    ]),
  );
  const active = projects
    .filter((p) => p.status === 'active')
    .map((project) => ({ project, health: health.get(project.id)! }));

  // Where time went: the last seven local days by area, sessions split at midnight.
  const timeByArea = computeTimeByArea(
    { sessions, tasks, projects, now },
    trailingRange(toLocalDate(now), 7),
  ).map(({ areaId, minutes }) => ({
    area: areaId ? (areaById.get(areaId) ?? null) : null,
    minutes,
  }));

  const personById = new Map(people.map((p) => [p.id, p]));
  const weekOut = new Date(now.getTime() + 7 * DAY_MS).toISOString();
  const upcomingCommitments = commitments
    .filter((c) => c.status === 'open' && (!c.dueAt || c.dueAt <= weekOut))
    .sort((a, b) => ((a.dueAt ?? '9') < (b.dueAt ?? '9') ? -1 : 1))
    .slice(0, 5)
    .map((commitment) => ({ commitment, person: personById.get(commitment.personId) }));

  const runningSession = activeSession(sessions);

  return {
    date,
    now,
    isToday: toLocalDate(now) === date,
    proposal,
    commitment: dayCommitments[0] ?? null,
    timeline,
    taskById,
    projectById,
    areaById,
    goalById,
    atRisk,
    timeByArea,
    upcomingCommitments,
    activeProjects: active.sort((a, b) => a.project.title.localeCompare(b.project.title)),
    runningSession,
  };
}

/** Accept a proposal: replace the day's unlocked planner blocks and write the commitment. */
export async function acceptPlan(
  repo: Repository,
  proposal: PlanProposal,
  clock: Clock = systemClock,
): Promise<DayCommitment> {
  const existing = (await repo.dayCommitments.query((c) => c.date === proposal.date))[0] ?? null;
  const { commitment, blocks } = materializePlan(proposal, clock, existing);
  const stale = await repo.blocks.query(
    (b) => b.date === proposal.date && b.source === 'planner' && !b.locked,
  );
  await repo.transaction(async (tx) => {
    for (const b of stale) await tx.blocks.softDelete(b.id);
    for (const b of blocks) await tx.blocks.upsert(b);
    await tx.dayCommitments.upsert(commitment);
  });
  bumpData();
  return commitment;
}

/** Drop the day's commitment and its unlocked planner blocks so a new proposal can be accepted. */
export async function unplanDay(repo: Repository, date: LocalDate): Promise<void> {
  const [commitments, blocks] = await Promise.all([
    repo.dayCommitments.query((c) => c.date === date),
    repo.blocks.query((b) => b.date === date && b.source === 'planner' && !b.locked),
  ]);
  await repo.transaction(async (tx) => {
    for (const c of commitments) await tx.dayCommitments.softDelete(c.id);
    for (const b of blocks) await tx.blocks.softDelete(b.id);
  });
  bumpData();
}

/** A block referencing the task that is next to do: the first still ahead of now, else the last. */
export function nextBlock(
  blocks: readonly ProposedBlock[],
  nowMin: number | null,
): ProposedBlock | null {
  const work = blocks.filter((b) => b.taskId && b.kind !== 'event');
  if (!work.length) return null;
  if (nowMin === null) return work[0]!;
  return work.find((b) => b.endMin > nowMin) ?? work[work.length - 1]!;
}

export type { Block };
