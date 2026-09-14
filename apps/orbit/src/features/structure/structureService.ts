import { defaultTaskEstimate } from '@/features/settings/settingsService';
import {
  AreaSchema,
  GoalSchema,
  MilestoneSchema,
  ProjectSchema,
  TaskSchema,
  archiveProjectCascade,
  assertAreaDeletable,
  buildProjectActivity,
  completeTask as completeTaskRecord,
  computeAreaAttention,
  computeGoalAttention,
  computeProjectHealth,
  createRecord,
  groupLinked,
  makeLink,
  resolveTaskParent,
  stopSession,
  systemClock,
  validateDependencies,
  validateGoalParent,
  validateProjectParent,
} from '@orbit/core';
import type {
  Area,
  AreaAttention,
  Bill,
  Clock,
  EntityRef,
  EntityType,
  Event,
  Goal,
  GoalAttention,
  Id,
  Link,
  Milestone,
  Note,
  Person,
  Project,
  ProjectHealth,
  Session,
  StructureSnapshot,
  Task,
} from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { bumpData } from '@/data/useQuery';
import { readSettings } from '@/features/settings/settingsService';

/** Everything the structure screens need, loaded in one pass. */
export interface StructureData extends StructureSnapshot {
  milestones: Milestone[];
  sessions: Session[];
  health: Map<Id, ProjectHealth>;
  goalAttention: Map<Id, GoalAttention>;
  areaAttention: Map<Id, AreaAttention>;
}

export async function loadStructure(
  repo: Repository,
  clock: Clock = systemClock,
): Promise<StructureData> {
  const [areas, goals, projects, allTasks, allMilestones, sessions, settings] = await Promise.all([
    repo.areas.list(),
    repo.goals.list(),
    repo.projects.list(),
    // Tombstones count as project activity (the shared staleness definition), nothing else.
    repo.tasks.list({ includeDeleted: true }),
    repo.milestones.list({ includeDeleted: true }),
    repo.sessions.list(),
    readSettings(repo, clock),
  ]);
  const tasks = allTasks.filter((t) => t.deletedAt === null);
  const milestones = allMilestones.filter((m) => m.deletedAt === null);
  const now = clock.now();
  const attentionInput = { areas, goals, projects, tasks, sessions, now };
  const staleAfterDays = settings.insights.staleProjectDays;
  const activity = buildProjectActivity({
    projects,
    tasks: allTasks,
    milestones: allMilestones,
    sessions,
  });
  return {
    areas: areas.sort((a, b) => a.name.localeCompare(b.name)),
    goals,
    projects,
    tasks,
    milestones,
    sessions,
    health: new Map(
      projects.map((p) => [
        p.id,
        computeProjectHealth(p, { milestones, tasks, sessions, now, staleAfterDays, activity }),
      ]),
    ),
    goalAttention: new Map(goals.map((g) => [g.id, computeGoalAttention(g, attentionInput)])),
    areaAttention: new Map(areas.map((a) => [a.id, computeAreaAttention(a, attentionInput)])),
  };
}

async function snapshot(repo: Repository): Promise<StructureSnapshot> {
  const [areas, goals, projects, tasks] = await Promise.all([
    repo.areas.list(),
    repo.goals.list(),
    repo.projects.list(),
    repo.tasks.list(),
  ]);
  return { areas, goals, projects, tasks };
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

export async function createArea(
  repo: Repository,
  fields: { name: string; weeklyHoursTarget?: number; color?: string },
  clock: Clock = systemClock,
): Promise<Area> {
  const area = await repo.areas.upsert(createRecord(AreaSchema, clock, fields));
  bumpData();
  return area;
}

export async function updateArea(
  repo: Repository,
  area: Area,
  patch: Partial<Pick<Area, 'name' | 'weeklyHoursTarget' | 'color'>>,
): Promise<Area> {
  const next = await repo.areas.upsert({ ...area, ...patch });
  bumpData();
  return next;
}

export async function deleteArea(repo: Repository, areaId: Id): Promise<void> {
  assertAreaDeletable(areaId, await snapshot(repo));
  await repo.areas.softDelete(areaId);
  bumpData();
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export async function createGoal(
  repo: Repository,
  fields: { title: string; areaId: Id; importance?: number; targetDate?: string | null },
  clock: Clock = systemClock,
): Promise<Goal> {
  validateGoalParent(fields, await snapshot(repo));
  const goal = await repo.goals.upsert(createRecord(GoalSchema, clock, fields));
  bumpData();
  return goal;
}

export async function updateGoal(
  repo: Repository,
  goal: Goal,
  patch: Partial<Omit<Goal, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>,
): Promise<Goal> {
  const merged = { ...goal, ...patch };
  if (patch.areaId) validateGoalParent(merged, await snapshot(repo));
  const next = await repo.goals.upsert(merged);
  bumpData();
  return next;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function createProject(
  repo: Repository,
  fields: {
    title: string;
    areaId: Id;
    goalId?: Id | null;
    outcome?: string;
    deadline?: string | null;
  },
  clock: Clock = systemClock,
): Promise<Project> {
  validateProjectParent(
    { areaId: fields.areaId, goalId: fields.goalId ?? null },
    await snapshot(repo),
  );
  const project = await repo.projects.upsert(createRecord(ProjectSchema, clock, fields));
  bumpData();
  return project;
}

export async function updateProject(
  repo: Repository,
  project: Project,
  patch: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>,
): Promise<Project> {
  const merged = { ...project, ...patch };
  if (patch.areaId !== undefined || patch.goalId !== undefined)
    validateProjectParent(merged, await snapshot(repo));
  const next = await repo.projects.upsert(merged);
  bumpData();
  return next;
}

export async function archiveProject(repo: Repository, project: Project): Promise<void> {
  const s = await snapshot(repo);
  const { project: archived, tasks } = archiveProjectCascade(project, s);
  await repo.transaction(async (tx) => {
    await tx.projects.upsert(archived);
    for (const t of tasks) await tx.tasks.upsert(t);
  });
  bumpData();
}

export async function setNextAction(
  repo: Repository,
  project: Project,
  taskId: Id | null,
): Promise<Project> {
  const next = await repo.projects.upsert({ ...project, nextActionTaskId: taskId });
  bumpData();
  return next;
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export async function addMilestone(
  repo: Repository,
  projectId: Id,
  title: string,
  clock: Clock = systemClock,
): Promise<Milestone> {
  const existing = await repo.milestones.query((m) => m.projectId === projectId);
  const order = existing.reduce((max, m) => Math.max(max, m.order + 1), 0);
  const milestone = await repo.milestones.upsert(
    createRecord(MilestoneSchema, clock, { projectId, title, order }),
  );
  bumpData();
  return milestone;
}

export async function toggleMilestone(repo: Repository, milestone: Milestone): Promise<Milestone> {
  const next = await repo.milestones.upsert({ ...milestone, done: !milestone.done });
  bumpData();
  return next;
}

export async function renameMilestone(
  repo: Repository,
  milestone: Milestone,
  title: string,
): Promise<Milestone> {
  const next = await repo.milestones.upsert({ ...milestone, title });
  bumpData();
  return next;
}

export async function removeMilestone(repo: Repository, milestone: Milestone): Promise<void> {
  await repo.milestones.softDelete(milestone.id);
  bumpData();
}

/** Move a milestone up or down one slot; renumbers the project's milestones 0..n. */
export async function moveMilestone(
  repo: Repository,
  milestone: Milestone,
  direction: -1 | 1,
): Promise<void> {
  const rows = (await repo.milestones.query((m) => m.projectId === milestone.projectId)).sort(
    (a, b) => a.order - b.order,
  );
  const i = rows.findIndex((m) => m.id === milestone.id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j]!, rows[i]!];
  await repo.transaction(async (tx) => {
    for (let k = 0; k < rows.length; k++) {
      const m = rows[k]!;
      if (m.order !== k) await tx.milestones.upsert({ ...m, order: k });
    }
  });
  bumpData();
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskFields = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>> & {
  title: string;
};

export async function createTask(
  repo: Repository,
  fields: TaskFields,
  clock: Clock = systemClock,
): Promise<Task> {
  const s = await snapshot(repo);
  const resolved = resolveTaskParent(
    { projectId: fields.projectId ?? null, areaId: fields.areaId ?? null },
    s,
  );
  const estimateMin = fields.estimateMin ?? (await defaultTaskEstimate(repo, clock));
  const draft = createRecord(TaskSchema, clock, {
    status: 'open',
    ...fields,
    ...resolved,
    estimateMin,
  });
  if (draft.dependsOn.length) validateDependencies(draft.id, draft.dependsOn, s.tasks);
  const task = await repo.tasks.upsert(draft);
  bumpData();
  return task;
}

export async function updateTask(
  repo: Repository,
  task: Task,
  patch: Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>,
): Promise<Task> {
  const s = await snapshot(repo);
  let merged: Task = { ...task, ...patch };
  if (patch.projectId !== undefined || patch.areaId !== undefined)
    merged = resolveTaskParent(merged, s);
  if (patch.dependsOn) validateDependencies(task.id, patch.dependsOn, s.tasks);
  const next = await repo.tasks.upsert(merged);
  bumpData();
  return next;
}

/**
 * Mark a task done. A running timer on it stops first; with sessions the
 * actual comes from them when none is given, otherwise it stays null for
 * the evening review to ask.
 */
export async function completeTask(
  repo: Repository,
  task: Task,
  actualMin: number | null,
  clock: Clock = systemClock,
): Promise<Task> {
  const sessions = await repo.sessions.query((s) => s.taskId === task.id);
  const running = sessions.find((s) => s.endAt === null);
  const next = await repo.transaction(async (tx) => {
    let all = sessions;
    if (running) {
      const stopped = await tx.sessions.upsert(stopSession(running, clock));
      all = sessions.map((s) => (s.id === running.id ? stopped : s));
    }
    return tx.tasks.upsert(completeTaskRecord(task, actualMin, all, clock));
  });
  bumpData();
  return next;
}

export async function reopenTask(repo: Repository, task: Task): Promise<Task> {
  const next = await repo.tasks.upsert({ ...task, status: 'open', completedAt: null });
  bumpData();
  return next;
}

export async function archiveTask(repo: Repository, task: Task): Promise<void> {
  await repo.tasks.upsert({ ...task, status: 'archived' });
  bumpData();
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export async function addLink(
  repo: Repository,
  from: EntityRef,
  to: EntityRef,
  linkType = 'related',
  clock: Clock = systemClock,
): Promise<Link> {
  const existing = await repo.links.forEntity(from.type, from.id);
  const { link, created } = makeLink(clock, existing, from, to, linkType);
  if (created) {
    await repo.links.upsert(link);
    bumpData();
  }
  return link;
}

export async function removeLink(repo: Repository, linkId: Id): Promise<void> {
  await repo.links.softDelete(linkId);
  bumpData();
}

export interface LinkedEntities {
  notes: Array<Note & { linkId?: Id }>;
  people: Array<Person & { linkId: Id }>;
  events: Array<Event & { linkId: Id }>;
  bills: Array<Bill & { linkId: Id }>;
  tasks: Array<Task & { linkId: Id }>;
}

/** Resolve the other ends of a project's links, plus notes that belong to it directly. */
export async function loadLinked(repo: Repository, entity: EntityRef): Promise<LinkedEntities> {
  const links = await repo.links.forEntity(entity.type, entity.id);
  const groups = groupLinked(links, entity);
  const ids = (type: EntityType) => (groups[type] ?? []).map((r) => r.id);
  const withLink = <T extends { id: Id }>(type: EntityType, rows: T[]) =>
    rows.map((r) => ({ ...r, linkId: groups[type]!.find((g) => g.id === r.id)!.link.id }));

  const [notes, people, events, bills, tasks] = await Promise.all([
    repo.notes.getMany(ids('note')),
    repo.people.getMany(ids('person')),
    repo.events.getMany(ids('event')),
    repo.bills.getMany(ids('bill')),
    repo.tasks.getMany(ids('task')),
  ]);
  const ownNotes =
    entity.type === 'project' ? await repo.notes.query((n) => n.projectId === entity.id) : [];
  const linkedNotes = withLink(
    'note',
    notes.filter((n) => n.deletedAt === null),
  );
  const seen = new Set(linkedNotes.map((n) => n.id));
  return {
    notes: [...linkedNotes, ...ownNotes.filter((n) => !seen.has(n.id))],
    people: withLink(
      'person',
      people.filter((p) => p.deletedAt === null),
    ),
    events: withLink(
      'event',
      events.filter((e) => e.deletedAt === null),
    ),
    bills: withLink(
      'bill',
      bills.filter((b) => b.deletedAt === null),
    ),
    tasks: withLink(
      'task',
      tasks.filter((t) => t.deletedAt === null),
    ),
  };
}

/** Candidates for the link picker: every live entity of the linkable kinds. */
export interface LinkCandidate extends EntityRef {
  label: string;
  hint?: string;
}

export async function loadLinkCandidates(
  repo: Repository,
  exclude?: EntityRef,
): Promise<LinkCandidate[]> {
  const [notes, people, events, bills, tasks, projects] = await Promise.all([
    repo.notes.list(),
    repo.people.list(),
    repo.events.list(),
    repo.bills.list(),
    repo.tasks.query((t) => t.status !== 'archived'),
    repo.projects.query((p) => p.status !== 'archived'),
  ]);
  const out: LinkCandidate[] = [
    ...notes.map((n) => ({ type: 'note' as const, id: n.id, label: n.title })),
    ...people.map((p) => ({ type: 'person' as const, id: p.id, label: p.name })),
    ...events.map((e) => ({
      type: 'event' as const,
      id: e.id,
      label: e.title,
      hint: e.startAt.slice(0, 10),
    })),
    ...bills.map((b) => ({
      type: 'bill' as const,
      id: b.id,
      label: b.title,
      hint: `${b.amount} ${b.currency}`.trim(),
    })),
    ...tasks.map((t) => ({ type: 'task' as const, id: t.id, label: t.title })),
    ...projects.map((p) => ({ type: 'project' as const, id: p.id, label: p.title })),
  ];
  return out.filter((c) => !(exclude && c.type === exclude.type && c.id === exclude.id));
}
