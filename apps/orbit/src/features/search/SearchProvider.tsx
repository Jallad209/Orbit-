import type { SearchService } from '@orbit/storage';
import { useEffect, useState, type ReactNode } from 'react';
import { usePlatform, useRepository } from '@/platform';
import { SearchContext, useSearchRefresh } from './searchService';

/** How long after the app opens the index starts building; the first screen renders first. */
export const SEARCH_WARMUP_DELAY_MS = 400;

interface Props {
  /** Supply a ready service (tests). Otherwise the platform builds one. */
  service?: SearchService;
  children: ReactNode;
}

/**
 * Creates the runtime's search index over the open repository, warms it
 * up shortly after the first paint, and keeps it refreshed after writes.
 * Nothing waits on it: a search before the first build simply awaits
 * `ready()`.
 */
export function SearchProvider({ service: given, children }: Props) {
  const platform = usePlatform();
  const repo = useRepository();
  const [created, setCreated] = useState<SearchService | null>(null);
  const service = given ?? created;

  useEffect(() => {
    if (given) return;
    let cancelled = false;
    let mine: SearchService | null = null;
    void platform.createSearchService(repo).then((s) => {
      if (cancelled) {
        void s.close?.();
        return;
      }
      mine = s;
      setCreated(s);
    });
    return () => {
      cancelled = true;
      if (mine) void mine.close?.();
    };
  }, [platform, repo, given]);

  useEffect(() => {
    if (!service) return;
    const timer = setTimeout(
      () => void service.ready().catch(() => undefined),
      SEARCH_WARMUP_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [service]);

  useSearchRefresh(service);

  return <SearchContext.Provider value={service}>{children}</SearchContext.Provider>;
}
