import {
  activeSession,
  startSession as startSessionRecord,
  stopSession as stopSessionRecord,
  systemClock,
} from '@orbit/core';
import type { Clock, Id, Session, Task } from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { bumpData } from '@/data/useQuery';

/** The running session and its task, as the timer shows them. */
export interface ActiveTimer {
  session: Session;
  task: Task | undefined;
}

/** The session with no end, read fresh from the repository (survives a restart). */
export async function loadActiveTimer(repo: Repository): Promise<ActiveTimer | null> {
  const session = activeSession(await repo.sessions.query((s) => s.endAt === null));
  if (!session) return null;
  return { session, task: await repo.tasks.get(session.taskId) };
}

/** Start a session on the task, closing whatever was running, in one write. */
export async function startSession(
  repo: Repository,
  taskId: Id,
  clock: Clock = systemClock,
): Promise<Session> {
  const running = await repo.sessions.query((s) => s.endAt === null);
  const { session, closed } = startSessionRecord(taskId, running, clock);
  await repo.transaction(async (tx) => {
    for (const s of closed) await tx.sessions.upsert(s);
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
  const next = await repo.sessions.upsert(stopSessionRecord(session, clock));
  bumpData();
  return next;
}

/** Stop whatever is running; null when nothing was. */
export async function stopActiveSession(
  repo: Repository,
  clock: Clock = systemClock,
): Promise<Session | null> {
  const active = activeSession(await repo.sessions.query((s) => s.endAt === null));
  return active ? stopSession(repo, active, clock) : null;
}

/** `25:13`, or `1:05:13` past an hour, for the window title and the header. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}
