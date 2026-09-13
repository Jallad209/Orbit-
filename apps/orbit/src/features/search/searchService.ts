import { parseSearchQuery } from '@orbit/storage';
import type { ParsedQuery, SearchFilters, SearchHit, SearchService } from '@orbit/storage';
import { createContext, useContext, useEffect, useState } from 'react';
import { useAppStore } from '@/app/store';
import { useRepoQuery } from '@/data/useQuery';

/**
 * The app's handle on the runtime's search index. `SearchProvider` (in
 * App.tsx) creates it once the repository is open, builds it in the
 * background so the first screen never waits, and refreshes it a moment
 * after every write. Screens read it with `useSearch`.
 */
export const SearchContext = createContext<SearchService | null>(null);

/** How long after the last write the index is refreshed; bursts coalesce. */
export const SEARCH_REFRESH_DEBOUNCE_MS = 250;
/** How long after the last keystroke a query runs. */
export const SEARCH_INPUT_DEBOUNCE_MS = 120;

export function useSearchService(): SearchService | null {
  return useContext(SearchContext);
}

/**
 * Keep the index a step behind the data: refresh a moment after the last
 * write here, and whenever the window regains focus (another tab or the
 * capture window may have written meanwhile; FTS5 needs no refresh, the
 * in-memory index does).
 */
export function useSearchRefresh(service: SearchService | null): void {
  const version = useAppStore((s) => s.dataVersion);
  useEffect(() => {
    if (!service) return;
    const timer = setTimeout(
      () => void service.refresh().catch(() => undefined),
      SEARCH_REFRESH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [service, version]);
  useEffect(() => {
    if (!service) return;
    const onFocus = () => void service.refresh().catch(() => undefined);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [service]);
}

export interface SearchState {
  hits: SearchHit[];
  loading: boolean;
  error: string | null;
  /** The query as understood: free text, filters, and any filter errors. */
  parsed: ParsedQuery;
}

export interface UseSearchOptions {
  limit?: number;
  filters?: SearchFilters;
  /** Skip searching (e.g. the palette is closed). */
  enabled?: boolean;
}

interface Settled {
  key: string;
  hits: SearchHit[];
  error: string | null;
}

/**
 * Debounced, cancellable search. Each query gets a key; a response is
 * kept only if its key is still the current one, so the list never shows
 * stale results. While a new query is in flight the previous hits stay
 * visible and `loading` is true.
 */
export function useSearch(query: string, options: UseSearchOptions = {}): SearchState {
  const service = useSearchService();
  const { data: areas } = useRepoQuery(async (repo) => repo.areas.list(), []);
  const parsed = parseSearchQuery(query, { areas: areas ?? [] });
  const { limit = 20, enabled = true } = options;
  const filtersKey = JSON.stringify(options.filters ?? null);
  const version = useAppStore((s) => s.dataVersion);
  const key =
    service && enabled && parsed.text ? JSON.stringify([query, filtersKey, limit, version]) : '';
  const [settled, setSettled] = useState<Settled>({ key: '', hits: [], error: null });

  useEffect(() => {
    if (!service || !key) return;
    let cancelled = false;
    const filters = filtersKey === 'null' ? undefined : (JSON.parse(filtersKey) as SearchFilters);
    const timer = setTimeout(() => {
      service
        .ready()
        .then(() => service.search(query, filters, limit))
        .then((hits) => {
          if (!cancelled) setSettled({ key, hits, error: null });
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setSettled({ key, hits: [], error: e instanceof Error ? e.message : String(e) });
          }
        });
    }, SEARCH_INPUT_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [service, key, query, filtersKey, limit]);

  if (!key) return { hits: [], loading: false, error: null, parsed };
  const current = settled.key === key;
  return {
    hits: settled.hits,
    loading: !current,
    error: current ? settled.error : null,
    parsed,
  };
}
