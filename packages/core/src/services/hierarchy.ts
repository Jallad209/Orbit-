import type { Area, Goal, Id, Milestone, Note, Project, Task } from '../schema';

/**
 * The canonical parent chain: Task → Project → Goal → Area. A task or
 * project may also hang directly off an area. These functions are pure over
 * arrays; the app loads a snapshot and persists the returned records.
 */
export interface StructureSnapshot {
  areas: Area[];
  goals: Goal[];
  projects: Project[];
  tasks: Task[];
  milestones?: Milestone[];
}

export type HierarchyErrorCode =
  | 'missing-area'
  | 'missing-goal'
  | 'missing-project'
  | 'area-mismatch'
  | 'archived-parent'
  | 'not-empty';

export class HierarchyError extends Error {
  constructor(
    public readonly code: HierarchyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HierarchyError';
  }
}

export function byId<T extends { id: Id; deletedAt: string | null }>(rows: T[]): Map<Id, T> {
  return new Map(rows.filter((r) => r.deletedAt === null).map((r) => [r.id, r]));
}

/** A goal must belong to an existing area. */
export function validateGoalParent(goal: Pick<Goal, 'areaId'>, s: StructureSnapshot): void {
  if (!byId(s.areas).has(goal.areaId))
    throw new HierarchyError('missing-area', 'That area does not exist.');
}

/** A project belongs to an area, and optionally to a goal in the same area. */
export function validateProjectParent(
  project: Pick<Project, 'areaId' | 'goalId'>,
  s: StructureSnapshot,
): void {
  if (!byId(s.areas).has(project.areaId))
    throw new HierarchyError('missing-area', 'That area does not exist.');
  if (project.goalId) {
    const goal = byId(s.goals).get(project.goalId);
    if (!goal) throw new HierarchyError('missing-goal', 'That goal does not exist.');
    if (goal.areaId !== project.areaId) {
      throw new HierarchyError('area-mismatch', 'A project must be in the same area as its goal.');
    }
  }
}

/**
 * A task may belong to a project (then its area is the project's) or to an
 * area directly. Returns the task with a consistent `areaId`.
 */
export function resolveTaskParent<T extends Pick<Task, 'projectId' | 'areaId'>>(
  task: T,
  s: StructureSnapshot,
): T {
  if (task.projectId) {
    const project = byId(s.projects).get(task.projectId);
    if (!project) throw new HierarchyError('missing-project', 'That project does not exist.');
    if (project.status === 'archived') {
      throw new HierarchyError('archived-parent', 'That project is archived. Restore it first.');
    }
    return { ...task, areaId: project.areaId };
  }
  if (task.areaId && !byId(s.areas).has(task.areaId)) {
    throw new HierarchyError('missing-area', 'That area does not exist.');
  }
  return task;
}

/**
 * The note-parent policy (week 12). A note may belong to a project (then
 * its area is the project's, never a contradicting one) or to an area
 * directly. A new assignment to a missing, deleted, or archived project is
 * refused; a note already inside an archived project keeps its parent and
 * stays editable. Returns the note with a consistent `areaId`.
 */
export function resolveNoteParent<T extends Pick<Note, 'projectId' | 'areaId'>>(
  note: T,
  s: StructureSnapshot,
  options: { previousProjectId?: Id | null } = {},
): T {
  if (note.projectId) {
    const project = byId(s.projects).get(note.projectId);
    if (!project) throw new HierarchyError('missing-project', 'That project does not exist.');
    if (project.status === 'archived' && options.previousProjectId !== note.projectId) {
      throw new HierarchyError('archived-parent', 'That project is archived. Restore it first.');
    }
    return { ...note, areaId: project.areaId };
  }
  if (note.areaId && !byId(s.areas).has(note.areaId)) {
    throw new HierarchyError('missing-area', 'That area does not exist.');
  }
  return note;
}

export interface TaskAncestors {
  project: Project | null;
  goal: Goal | null;
  area: Area | null;
}

export function ancestorsOfTask(task: Task, s: StructureSnapshot): TaskAncestors {
  const project = task.projectId ? (byId(s.projects).get(task.projectId) ?? null) : null;
  const goal = project?.goalId ? (byId(s.goals).get(project.goalId) ?? null) : null;
  const areaId = project?.areaId ?? task.areaId;
  const area = areaId ? (byId(s.areas).get(areaId) ?? null) : null;
  return { project, goal, area };
}

export interface AreaDescendants {
  goals: Goal[];
  projects: Project[];
  tasks: Task[];
}

export function descendantsOfArea(areaId: Id, s: StructureSnapshot): AreaDescendants {
  const goals = s.goals.filter((g) => g.deletedAt === null && g.areaId === areaId);
  const projects = s.projects.filter((p) => p.deletedAt === null && p.areaId === areaId);
  const projectIds = new Set(projects.map((p) => p.id));
  const tasks = s.tasks.filter(
    (t) =>
      t.deletedAt === null &&
      ((t.projectId && projectIds.has(t.projectId)) || (!t.projectId && t.areaId === areaId)),
  );
  return { goals, projects, tasks };
}

export function projectsOfGoal(goalId: Id, s: StructureSnapshot): Project[] {
  return s.projects.filter((p) => p.deletedAt === null && p.goalId === goalId);
}

export function tasksOfProject(projectId: Id, s: StructureSnapshot): Task[] {
  return s.tasks.filter((t) => t.deletedAt === null && t.projectId === projectId);
}

/** Archiving a project archives its open and inbox tasks; done tasks are left alone. */
export function archiveProjectCascade(
  project: Project,
  s: StructureSnapshot,
): { project: Project; tasks: Task[] } {
  const tasks = tasksOfProject(project.id, s)
    .filter((t) => t.status === 'open' || t.status === 'inbox')
    .map((t) => ({ ...t, status: 'archived' as const }));
  return { project: { ...project, status: 'archived', nextActionTaskId: null }, tasks };
}

/** An area can only be deleted when nothing lives in it. */
export function assertAreaDeletable(areaId: Id, s: StructureSnapshot): void {
  const d = descendantsOfArea(areaId, s);
  const live =
    d.goals.length + d.projects.length + d.tasks.filter((t) => t.status !== 'archived').length;
  if (live > 0) {
    throw new HierarchyError(
      'not-empty',
      `This area still holds ${d.goals.length} goals, ${d.projects.length} projects, and ${d.tasks.length} tasks. Move or archive them first.`,
    );
  }
}
