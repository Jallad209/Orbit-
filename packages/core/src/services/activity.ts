import type { Id, Instant, Milestone, Project, Session, Task } from '../schema';

/**
 * When a project last moved, shared by project health, the Today screen,
 * the at-risk rule, and the stale-project insight so no two surfaces can
 * disagree about the same project. Activity is any change to the project
 * record, to a task or milestone that belongs to it, or a session on one of
 * its tasks. A soft-deleted task or milestone counts through its tombstone
 * (its `projectId` is still there): deleting work is doing something to the
 * project. Tombstones count for nothing else. Snoozing an insight, reading
 * the project, or unrelated operations are not activity.
 */

export type ActivitySourceType = 'project' | 'task' | 'milestone' | 'session';

export interface ProjectActivity {
  at: Instant;
  source: {
    type: ActivitySourceType;
    id: Id;
    /** The task or milestone title; for a session, its task's title. */
    title: string | null;
    /** The source is a tombstone: the deletion itself was the activity. */
    deleted: boolean;
  };
}

export interface ActivityInput {
  projects: readonly Project[];
  /** May include tombstones. */
  tasks: readonly Task[];
  /** May include tombstones. */
  milestones?: readonly Milestone[];
  sessions?: readonly Session[];
}

const DAY_MS = 86_400_000;

function later(a: ProjectActivity | undefined, b: ProjectActivity): ProjectActivity {
  if (!a) return b;
  if (b.at > a.at) return b;
  // Same instant: a stable choice so input order cannot change the answer.
  if (b.at === a.at && b.source.id < a.source.id) return b;
  return a;
}

/**
 * The last activity per project, built in one pass over every record.
 * Projects without any record (impossible in practice) are absent.
 */
export function buildProjectActivity(input: ActivityInput): Map<Id, ProjectActivity> {
  const out = new Map<Id, ProjectActivity>();
  const taskProject = new Map<Id, { projectId: Id; title: string }>();
  for (const p of input.projects) {
    if (p.deletedAt !== null) continue;
    out.set(
      p.id,
      later(out.get(p.id), {
        at: p.updatedAt,
        source: { type: 'project', id: p.id, title: null, deleted: false },
      }),
    );
  }
  for (const t of input.tasks) {
    if (!t.projectId) continue;
    taskProject.set(t.id, { projectId: t.projectId, title: t.title });
    if (!out.has(t.projectId)) continue;
    out.set(
      t.projectId,
      later(out.get(t.projectId), {
        at: t.updatedAt,
        source: { type: 'task', id: t.id, title: t.title, deleted: t.deletedAt !== null },
      }),
    );
  }
  for (const m of input.milestones ?? []) {
    if (!out.has(m.projectId)) continue;
    out.set(
      m.projectId,
      later(out.get(m.projectId), {
        at: m.updatedAt,
        source: { type: 'milestone', id: m.id, title: m.title, deleted: m.deletedAt !== null },
      }),
    );
  }
  for (const s of input.sessions ?? []) {
    if (s.deletedAt !== null) continue;
    const task = taskProject.get(s.taskId);
    if (!task || !out.has(task.projectId)) continue;
    out.set(
      task.projectId,
      later(out.get(task.projectId), {
        at: s.endAt ?? s.startAt,
        source: { type: 'session', id: s.id, title: task.title, deleted: false },
      }),
    );
  }
  return out;
}

/**
 * Complete elapsed 24-hour periods since `at`. A future or unparseable
 * timestamp counts as zero days, never a negative number.
 */
export function elapsedDays(at: Instant, now: Date): number {
  const ms = now.getTime() - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / DAY_MS);
}

/** The instant a project becomes stale under `staleAfterDays`, from its last activity. */
export function staleAt(activity: ProjectActivity, staleAfterDays: number): Instant {
  return new Date(new Date(activity.at).getTime() + staleAfterDays * DAY_MS).toISOString();
}
