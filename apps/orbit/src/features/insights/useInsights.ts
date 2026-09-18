import { systemClock } from '@orbit/core';
import type { Clock } from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/app/store';
import { loadInsightView, type InsightView } from './insightService';

/**
 * One insight computation per data generation, shared by every surface.
 * Refreshes on: a local write (`dataVersion`, debounced), the next time
 * boundary the last report named (snooze expiry, stale threshold, sample
 * expiry, local midnight — one timer, not one per card), window focus or
 * visibility (another window's commit moves the op-log head; system resume
 * looks the same), and an explicit retry. Obsolete reads are dropped: a
 * result computed against an older repository or generation never replaces
 * a newer one.
 */

export interface InsightsState {
  view: InsightView | null;
  loading: boolean;
  error: Error | null;
  /** The view shown is from before a refresh that failed; retry is offered. */
  stale: boolean;
  refresh: () => void;
}

export const REFRESH_DEBOUNCE_MS = 250;
/** Let the first route become interactive before scanning a large repository. */
export const INITIAL_INSIGHTS_DELAY_MS = import.meta.env.MODE === 'test' ? 0 : 3_000;
/** setTimeout cannot wait longer than this; the timer re-arms after it. */
const MAX_TIMER_MS = 2_147_000_000;

export const InsightsContext = createContext<InsightsState | null>(null);

export function useInsights(): InsightsState {
  const ctx = useContext(InsightsContext);
  if (!ctx) throw new Error('useInsights must be used inside <InsightsProvider>');
  return ctx;
}

/** A result is only ever shown beside the repository it was read from. */
interface Settled {
  repo: Repository;
  view: InsightView | null;
  error: Error | null;
}

/** The provider's engine, as a hook so tests can drive it without the tree. */
export function useInsightsEngine(repo: Repository, clock: Clock = systemClock): InsightsState {
  const version = useAppStore((s) => s.dataVersion);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const generation = useRef(0);
  const settledRef = useRef<Settled | null>(null);
  const inflight = useRef(false);

  // A new repository (restore, relocate) shows nothing until its own read lands.
  const current = settled && settled.repo === repo ? settled : null;
  const view = current?.view ?? null;
  const error = current?.error ?? null;

  const compute = useCallback(async () => {
    const mine = (generation.current += 1);
    inflight.current = true;
    setLoading(true);
    try {
      const next = await loadInsightView(repo, clock);
      if (mine !== generation.current) return; // superseded: a newer read is on its way
      const done = { repo, view: next, error: null };
      settledRef.current = done;
      setSettled(done);
    } catch (e) {
      if (mine !== generation.current) return;
      const previous = settledRef.current?.repo === repo ? settledRef.current.view : null;
      const done = { repo, view: previous, error: e instanceof Error ? e : new Error(String(e)) };
      settledRef.current = done;
      setSettled(done);
    } finally {
      if (mine === generation.current) {
        inflight.current = false;
        setLoading(false);
      }
    }
  }, [repo, clock]);

  // Local writes, settings saves (they bump too), and explicit retries: debounced. The first
  // read waits out the initial delay from mount even when boot itself writes (routine
  // instances, settings creation), so it never competes with the first screen's own load;
  // an explicit retry is the one thing that skips the wait.
  const firstReadAt = useRef<number | null>(null);
  useEffect(() => {
    let delay = REFRESH_DEBOUNCE_MS;
    if (generation.current === 0 && tick === 0) {
      firstReadAt.current ??= Date.now() + INITIAL_INSIGHTS_DELAY_MS;
      delay = Math.max(0, firstReadAt.current - Date.now());
    }
    const timer = setTimeout(() => void compute(), delay);
    return () => clearTimeout(timer);
  }, [compute, version, tick]);

  // One timer to the next boundary the report named.
  const boundary = view?.nextBoundaryAt ?? null;
  useEffect(() => {
    if (!boundary) return;
    const delay = new Date(boundary).getTime() - clock.now().getTime();
    const timer = setTimeout(() => void compute(), Math.min(Math.max(delay, 0), MAX_TIMER_MS));
    return () => clearTimeout(timer);
  }, [boundary, compute, clock]);

  // Focus and visibility: another window may have committed; a resumed machine may be past a
  // boundary. Recompute only when the op-log head moved or a boundary passed.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'hidden' || inflight.current) return;
      const known = settledRef.current;
      const shown = known && known.repo === repo ? known.view : null;
      if (!shown) return void compute();
      const passed =
        shown.nextBoundaryAt !== null && shown.nextBoundaryAt <= clock.now().toISOString();
      if (passed) return void compute();
      void repo.opLog
        .latestSeq()
        .then((seq) => {
          if (seq !== shown.opLogSeq && settledRef.current === known) void compute();
        })
        .catch(() => undefined);
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [compute, repo, clock]);

  // Nothing from an unmounted provider may land.
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { view, loading, error, stale: error !== null && view !== null, refresh };
}
