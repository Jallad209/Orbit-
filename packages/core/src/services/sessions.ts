import type { Clock } from '../clock';
import { nowIso } from '../clock';
import { createRecord } from '../records';
import type { Id, Instant, Session } from '../schema';
import { SessionSchema } from '../schema';

/**
 * Work sessions: the record of what actually happened. Pure over arrays;
 * the app service writes what these return. A session stores wall-clock
 * instants, never a monotonic timer, so a running session survives a
 * restart: the elapsed time is always `now − startAt`.
 */

export interface StartSessionResult {
  session: Session;
  /** Running sessions closed at the same instant so only one timer runs. */
  closed: Session[];
}

/** The session with no end, if any. At most one is expected. */
export function activeSession(sessions: readonly Session[]): Session | null {
  const running = sessions.filter((s) => s.deletedAt === null && s.endAt === null);
  if (!running.length) return null;
  // Newest start wins should the invariant ever be broken (e.g. a crash mid-write).
  return running.reduce((a, b) => (b.startAt > a.startAt ? b : a));
}

/** Start a session on `taskId`, closing whatever was running. */
export function startSession(
  taskId: Id,
  sessions: readonly Session[],
  clock: Clock,
): StartSessionResult {
  const at = nowIso(clock);
  const closed = sessions
    .filter((s) => s.deletedAt === null && s.endAt === null)
    .map((s) => SessionSchema.parse({ ...s, endAt: at > s.startAt ? at : s.startAt }));
  const session = createRecord(SessionSchema, clock, { taskId, startAt: at, endAt: null });
  return { session, closed };
}

/** Close a running session now. A session that already ended is returned unchanged. */
export function stopSession(session: Session, clock: Clock): Session {
  if (session.endAt !== null) return session;
  const at = nowIso(clock);
  return SessionSchema.parse({ ...session, endAt: at > session.startAt ? at : session.startAt });
}

/** A session entered by hand, e.g. "I worked on this from 14:00 to 15:30". */
export function manualSession(taskId: Id, startAt: Instant, endAt: Instant, clock: Clock): Session {
  return createRecord(SessionSchema, clock, { taskId, startAt, endAt });
}

/** Minutes a session lasted; a running session counts up to `now`. Never negative. */
export function sessionMinutes(session: Session, now: Date): number {
  const end = session.endAt ? new Date(session.endAt) : now;
  return Math.max(0, (end.getTime() - new Date(session.startAt).getTime()) / 60_000);
}

/** Total minutes recorded on a task across its sessions. */
export function taskSessionMinutes(taskId: Id, sessions: readonly Session[], now: Date): number {
  let total = 0;
  for (const s of sessions) {
    if (s.deletedAt === null && s.taskId === taskId) total += sessionMinutes(s, now);
  }
  return total;
}

/** Whether any session, running or finished, was recorded on the task. */
export function hasSession(taskId: Id, sessions: readonly Session[]): boolean {
  return sessions.some((s) => s.deletedAt === null && s.taskId === taskId);
}
