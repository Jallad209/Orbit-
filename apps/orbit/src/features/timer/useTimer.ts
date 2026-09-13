import { systemClock } from '@orbit/core';
import type { Clock, Id } from '@orbit/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRepoQuery } from '@/data/useQuery';
import { useRepository } from '@/platform';
import {
  formatElapsed,
  loadActiveTimer,
  startSession,
  stopSession,
  type ActiveTimer,
} from './timerService';

export interface Timer {
  /** The running session and its task; null while idle. */
  active: ActiveTimer | null;
  running: boolean;
  /** Whether the first read from the repository has completed. */
  loading: boolean;
  /** Seconds since the running session started; 0 while idle. */
  elapsedSec: number;
  /** `25:13` */
  elapsed: string;
  start: (taskId: Id) => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * The work timer. The running session lives in the repository, so mounting
 * after a restart picks it up where it was; elapsed time is wall clock,
 * `now − startAt`, never a counter. Ticks once a second while running and
 * puts `25:13 · Task name` in the window title.
 */
export function useTimer(clock: Clock = systemClock): Timer {
  const repo = useRepository();
  const { data, loading } = useRepoQuery(loadActiveTimer, []);
  const active = data ?? null;
  const sessionId = active?.session.id ?? null;
  const taskTitle = active?.task?.title ?? 'Task';
  // The tick only forces a render; the value always comes from the clock.
  const [, setTick] = useState(0);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);

  // One interval per running session, cleared when it stops or the component unmounts.
  useEffect(() => {
    if (!sessionId) return;
    interval.current = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      if (interval.current) clearInterval(interval.current);
      interval.current = null;
    };
  }, [sessionId]);

  const elapsedSec = active
    ? Math.max(
        0,
        Math.floor((clock.now().getTime() - new Date(active.session.startAt).getTime()) / 1000),
      )
    : 0;
  const elapsed = formatElapsed(elapsedSec);

  // Window title while running; the page's own title comes back when it stops.
  useEffect(() => {
    if (!sessionId) return;
    const base = document.title;
    return () => {
      document.title = base;
    };
  }, [sessionId]);
  useEffect(() => {
    if (!sessionId) return;
    document.title = `${elapsed} · ${taskTitle}`;
  }, [sessionId, elapsed, taskTitle]);

  const start = useCallback(
    async (taskId: Id) => {
      await startSession(repo, taskId, clock);
    },
    [repo, clock],
  );
  const stop = useCallback(async () => {
    if (active) await stopSession(repo, active.session, clock);
  }, [repo, active, clock]);

  return { active, running: active !== null, loading, elapsedSec, elapsed, start, stop };
}
