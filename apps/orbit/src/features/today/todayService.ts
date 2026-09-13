import {
  SessionSchema,
  addDays,
  computeGoalAttention,
  computeProjectHealth,
  createRecord,
  localRange,
  materializePlan,
  minuteOfDay,
  planDay,
  systemClock,
  toLocalDate,
} from '@orbit/core';
import type {
  Area,
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

export interface Insight {
  key: string;
  title: string;
  detail: string;
  evidence: string[];
  tone: 'danger' | 'gold' | 'neutral';
}

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
  atRisk: {
    overdue: Task[];
    dueSoon: Task[];
    projects: Array<{ project: Project; health: ProjectHealth }>;
  };
  timeByArea: Array<{ area: Area | null; minutes: number }>;
  upcomingCommitments: Array<{ commitment: Commitment; person: Person | undefined }>;
  activeProjects: Array<{ project: Project; health: ProjectHealth }>;
  insights: Insight[];
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
  const now = clock.now();
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
    commitments,
    people,
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
    repo.commitments.list(),
    repo.people.list(),
    repo.dayCommitments.query((c) => c.date === date),
  ]);

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

  // At risk: overdue, due within three days without a block today, projects near a deadline.
  const plannedToday = new Set(
    [...proposal.blocks, ...timeline].map((b) => b.taskId).filter((id): id is Id => !!id),
  );
  const open = tasks.filter((t) => t.status === 'open');
  const soonLimit = addDays(date, 3);
  const overdue = open
    .filter((t) => t.dueAt && toLocalDate(new Date(t.dueAt)) < date)
    .sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : 1));
  const dueSoon = open
    .filter((t) => {
      if (!t.dueAt) return false;
      const d = toLocalDate(new Date(t.dueAt));
      return d >= date && d <= soonLimit && !plannedToday.has(t.id);
    })
    .sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : 1));
  const health = new Map(
    projects.map((p) => [p.id, computeProjectHealth(p, { milestones, tasks, sessions, now })]),
  );
  const active = projects
    .filter((p) => p.status === 'active')
    .map((project) => ({ project, health: health.get(project.id)! }));
  const nearDeadline = active
    .filter((x) => x.health.daysToDeadline !== null && x.health.daysToDeadline <= 7)
    .sort((a, b) => a.health.daysToDeadline! - b.health.daysToDeadline!);

  // Where time went: sessions in the last 7 days by area.
  const since = now.getTime() - 7 * DAY_MS;
  const minutesByArea = new Map<Id | null, number>();
  for (const s of sessions) {
    const end = s.endAt ? new Date(s.endAt) : now;
    if (end.getTime() < since) continue;
    const minutes = Math.max(0, (end.getTime() - new Date(s.startAt).getTime()) / 60_000);
    const task = taskById.get(s.taskId);
    const areaId =
      task?.areaId ?? (task?.projectId ? (projectById.get(task.projectId)?.areaId ?? null) : null);
    minutesByArea.set(areaId, (minutesByArea.get(areaId) ?? 0) + minutes);
  }
  const timeByArea = [...minutesByArea.entries()]
    .map(([areaId, minutes]) => ({
      area: areaId ? (areaById.get(areaId) ?? null) : null,
      minutes: Math.round(minutes),
    }))
    .filter((x) => x.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  const personById = new Map(people.map((p) => [p.id, p]));
  const weekOut = new Date(now.getTime() + 7 * DAY_MS).toISOString();
  const upcomingCommitments = commitments
    .filter((c) => c.status === 'open' && (!c.dueAt || c.dueAt <= weekOut))
    .sort((a, b) => ((a.dueAt ?? '9') < (b.dueAt ?? '9') ? -1 : 1))
    .slice(0, 5)
    .map((commitment) => ({ commitment, person: personById.get(commitment.personId) }));

  const insights = computeInsightsStub({ goals, areas, projects, tasks, sessions, now, health });

  const runningSession = sessions.find((s) => s.endAt === null) ?? null;

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
    atRisk: { overdue, dueSoon, projects: nearDeadline },
    timeByArea,
    upcomingCommitments,
    activeProjects: active.sort((a, b) => a.project.title.localeCompare(b.project.title)),
    insights,
    runningSession,
  };
}

/**
 * Until the insight engine lands (week 11), the strip shows the three
 * strongest neglect signals the structure services already compute.
 */
function computeInsightsStub(input: {
  goals: Goal[];
  areas: Area[];
  projects: Project[];
  tasks: Task[];
  sessions: Session[];
  now: Date;
  health: Map<Id, ProjectHealth>;
}): Insight[] {
  const out: Insight[] = [];
  const neglected = input.goals.filter(
    (g) => g.status === 'active' && computeGoalAttention(g, input).neglected,
  );
  if (neglected.length) {
    out.push({
      key: 'neglected-goals',
      title: `${neglected.length} goal${neglected.length === 1 ? '' : 's'} got no time in 14 days`,
      detail: neglected.map((g) => g.title).join(', '),
      evidence: neglected.map((g) => `“${g.title}”: 0 minutes of sessions in the last 14 days`),
      tone: 'gold',
    });
  }
  const stale = input.projects.filter((p) => input.health.get(p.id)?.stale);
  if (stale.length) {
    out.push({
      key: 'stale-projects',
      title: `${stale.length} project${stale.length === 1 ? ' has' : 's have'} stopped moving`,
      detail: stale.map((p) => p.title).join(', '),
      evidence: stale.map(
        (p) => `“${p.title}”: no change for ${input.health.get(p.id)!.staleDays} days`,
      ),
      tone: 'neutral',
    });
  }
  const blocked = input.projects.filter((p) => input.health.get(p.id)?.blocked);
  if (blocked.length) {
    out.push({
      key: 'blocked-projects',
      title: `${blocked.length} project${blocked.length === 1 ? ' is' : 's are'} fully blocked`,
      detail: blocked.map((p) => p.title).join(', '),
      evidence: blocked.map((p) => `“${p.title}”: every open task waits on another task`),
      tone: 'danger',
    });
  }
  const overdue = input.tasks.filter(
    (t) => t.status === 'open' && t.dueAt && new Date(t.dueAt) < input.now,
  );
  if (overdue.length) {
    out.push({
      key: 'overdue-tasks',
      title: `${overdue.length} task${overdue.length === 1 ? ' is' : 's are'} overdue`,
      detail: overdue
        .slice(0, 3)
        .map((t) => t.title)
        .join(', '),
      evidence: overdue.map((t) => `“${t.title}” was due ${t.dueAt!.slice(0, 10)}`),
      tone: 'danger',
    });
  }
  return out.slice(0, 3);
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

export async function startSession(
  repo: Repository,
  taskId: Id,
  clock: Clock = systemClock,
): Promise<Session> {
  const running = await repo.sessions.query((s) => s.endAt === null);
  const at = clock.now().toISOString();
  const session = createRecord(SessionSchema, clock, { taskId, startAt: at, endAt: null });
  await repo.transaction(async (tx) => {
    for (const s of running) await tx.sessions.upsert({ ...s, endAt: at });
    await tx.sessions.upsert(session);
  });
  bumpData();
  return session;
}

export async function stopSession(
  repo: Repository,
  session: Session,
  clock: Clock = systemClock,
): Promise<Session> {
  const next = await repo.sessions.upsert({ ...session, endAt: clock.now().toISOString() });
  bumpData();
  return next;
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
