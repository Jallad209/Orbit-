import type {
  Area,
  Block,
  Commitment,
  DayCommitment,
  Goal,
  Id,
  LocalDate,
  Person,
  Project,
  Routine,
  RoutineInstance,
  Task,
} from '../schema';
import { isOpenCommitment } from '../services/people';
import { buildProjectActivity, type ProjectActivity } from '../services/activity';
import { areaOfTask } from '../services/timeByArea';
import type { InsightSnapshot } from './types';

/**
 * The snapshot indexed once. Every detector reads these maps instead of
 * filtering the task list again per project, area, date, or card: with
 * fifty thousand tasks that is the difference between one pass and hundreds.
 */
export interface InsightIndex {
  now: Date;
  areaById: Map<Id, Area>;
  goalById: Map<Id, Goal>;
  projectById: Map<Id, Project>;
  /** Live tasks only. */
  taskById: Map<Id, Task>;
  personById: Map<Id, Person>;
  routineById: Map<Id, Routine>;
  instanceById: Map<Id, RoutineInstance>;
  /** Live, closed, valid sessions that ended by `now`, summed per task. */
  closedSessionMin: Map<Id, number>;
  blocksByDate: Map<LocalDate, Block[]>;
  commitmentsByDate: Map<LocalDate, DayCommitment[]>;
  /** Live open commitments per live person. */
  openCommitmentsByPerson: Map<Id, Commitment[]>;
  activity: Map<Id, ProjectActivity>;
  /** A task's effective area: its own, else its project's; null when none resolves. */
  areaOf(task: Task): Id | null;
}

function liveMap<T extends { id: Id; deletedAt: string | null }>(rows: readonly T[]): Map<Id, T> {
  const out = new Map<Id, T>();
  for (const r of rows) if (r.deletedAt === null) out.set(r.id, r);
  return out;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildInsightIndex(snapshot: InsightSnapshot, now: Date): InsightIndex {
  const areaById = liveMap(snapshot.areas);
  const projectById = liveMap(snapshot.projects);
  const taskById = liveMap(snapshot.tasks);
  const personById = liveMap(snapshot.people);
  const routineById = liveMap(snapshot.routines);
  const instanceById = liveMap(snapshot.routineInstances);

  const closedSessionMin = new Map<Id, number>();
  const nowMs = now.getTime();
  for (const s of snapshot.sessions) {
    if (s.deletedAt !== null || s.endAt === null) continue;
    const start = new Date(s.startAt).getTime();
    const end = new Date(s.endAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end > nowMs) continue;
    closedSessionMin.set(s.taskId, (closedSessionMin.get(s.taskId) ?? 0) + (end - start) / 60_000);
  }

  const blocksByDate = new Map<LocalDate, Block[]>();
  for (const b of snapshot.blocks) if (b.deletedAt === null) push(blocksByDate, b.date, b);
  const commitmentsByDate = new Map<LocalDate, DayCommitment[]>();
  for (const c of snapshot.dayCommitments) {
    if (c.deletedAt === null) push(commitmentsByDate, c.date, c);
  }
  const openCommitmentsByPerson = new Map<Id, Commitment[]>();
  for (const c of snapshot.commitments) {
    // One definition of "open" for the badge, the detector, and the people screen.
    if (!isOpenCommitment(c) || !personById.has(c.personId)) continue;
    push(openCommitmentsByPerson, c.personId, c);
  }

  return {
    now,
    areaById,
    goalById: liveMap(snapshot.goals),
    projectById,
    taskById,
    personById,
    routineById,
    instanceById,
    closedSessionMin,
    blocksByDate,
    commitmentsByDate,
    openCommitmentsByPerson,
    activity: buildProjectActivity({
      projects: snapshot.projects,
      tasks: snapshot.tasks,
      milestones: snapshot.milestones,
      sessions: snapshot.sessions,
    }),
    areaOf: (task) => {
      const areaId = areaOfTask(task, projectById);
      return areaId && areaById.has(areaId) ? areaId : null;
    },
  };
}
