import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import type { Repository } from '@orbit/storage';
import { useAppStore } from '@/app/store';
import { useRepository } from '@/platform';

export interface QueryState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

/**
 * Read from the repository and re-run whenever `deps` change or any service
 * calls `bumpData()` after a write. Simple and explicit; live queries can
 * replace this later without touching callers.
 */
export function useRepoQuery<T>(
  query: (repo: Repository) => Promise<T>,
  deps: DependencyList = [],
): QueryState<T> {
  const repo = useRepository();
  const version = useAppStore((s) => s.dataVersion);
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  });

  useEffect(() => {
    let cancelled = false;
    queryRef
      .current(repo)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, version, tick, ...deps]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, refresh };
}

/** Call after any write so every `useRepoQuery` re-reads. */
export function bumpData(): void {
  useAppStore.getState().bump();
}
