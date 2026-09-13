import { addDays, fromLocalDate, toLocalDate } from '../dates';
import type { DateRange } from '../recurrence/expand';
import type { Id, LocalDate, Project, Session, Task } from '../schema';

/**
 * "Where is my time going": session minutes summed per area over a range
 * of local dates. A session that crosses local midnight is split at
 * midnight and each part counts toward its own day, so a 23:30–00:30
 * session gives 30 minutes to each date. Local dates throughout, never UTC.
 */

export interface SessionDayPart {
  date: LocalDate;
  minutes: number;
}

export interface TimeByAreaInput {
  sessions: readonly Session[];
  tasks: readonly Task[];
  /** Resolves a task's area through its project when the task has none. */
  projects?: readonly Project[];
  /** End of a running session. */
  now: Date;
}

export interface AreaMinutes {
  /** null = sessions on tasks with no area. */
  areaId: Id | null;
  minutes: number;
}

/** Split a session into per-date parts at local midnight. Empty when it has no length. */
export function sessionDayParts(session: Session, now: Date): SessionDayPart[] {
  const start = new Date(session.startAt);
  const end = session.endAt ? new Date(session.endAt) : now;
  if (end.getTime() <= start.getTime()) return [];
  const parts: SessionDayPart[] = [];
  let cursor = start;
  for (;;) {
    const date = toLocalDate(cursor);
    const nextMidnight = fromLocalDate(addDays(date, 1));
    const partEnd = end.getTime() < nextMidnight.getTime() ? end : nextMidnight;
    parts.push({ date, minutes: (partEnd.getTime() - cursor.getTime()) / 60_000 });
    if (partEnd.getTime() >= end.getTime()) break;
    cursor = nextMidnight;
  }
  return parts;
}

/** A task's area: its own, else its project's. */
export function areaOfTask(task: Task, projectById: ReadonlyMap<Id, Project>): Id | null {
  if (task.areaId) return task.areaId;
  return task.projectId ? (projectById.get(task.projectId)?.areaId ?? null) : null;
}

/** Minutes per area for the dates in `range`, largest first; zero rows dropped. */
export function timeByArea(input: TimeByAreaInput, range: DateRange): AreaMinutes[] {
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  const projectById = new Map((input.projects ?? []).map((p) => [p.id, p]));
  const minutesByArea = new Map<Id | null, number>();
  for (const s of input.sessions) {
    if (s.deletedAt !== null) continue;
    let minutes = 0;
    for (const part of sessionDayParts(s, input.now)) {
      if (part.date >= range.from && part.date <= range.to) minutes += part.minutes;
    }
    if (minutes <= 0) continue;
    const task = taskById.get(s.taskId);
    const areaId = task ? areaOfTask(task, projectById) : null;
    minutesByArea.set(areaId, (minutesByArea.get(areaId) ?? 0) + minutes);
  }
  // Most time first; tasks with no area last.
  return [...minutesByArea.entries()]
    .map(([areaId, minutes]) => ({ areaId, minutes: Math.round(minutes) }))
    .filter((x) => x.minutes > 0)
    .sort(
      (a, b) =>
        b.minutes - a.minutes ||
        Number(a.areaId === null) - Number(b.areaId === null) ||
        (a.areaId ?? '').localeCompare(b.areaId ?? ''),
    );
}

/** The last `days` local dates ending on `date`, inclusive. */
export function trailingRange(date: LocalDate, days: number): DateRange {
  return { from: addDays(date, -(days - 1)), to: date };
}
