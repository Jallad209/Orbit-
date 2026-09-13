import type { EntityType, Id } from '@orbit/core';

/**
 * The search contract both runtimes share. A `SearchService` is a
 * rebuildable cache over the repository: the repository stays the source of
 * truth, the index only answers "which records mention this".
 */

/** What can be found. Everything else is reached from these. */
export type SearchableType = Extract<EntityType, 'task' | 'note' | 'project' | 'person'>;
export const SEARCHABLE_TYPES: readonly SearchableType[] = ['task', 'note', 'project', 'person'];

export function isSearchableType(value: string): value is SearchableType {
  return (SEARCHABLE_TYPES as readonly string[]).includes(value);
}

export interface SearchFilters {
  /** Restrict to these types. Empty or absent means all four. */
  types?: readonly SearchableType[];
  /** Only records filed under this area (tasks, notes, projects). */
  areaId?: Id;
}

export interface SearchHit {
  id: Id;
  type: SearchableType;
  title: string;
  /** Plain text around the first body match, or the start of the body. Never markup. */
  snippet: string;
  /** Backend relevance; only comparable within one result list. Higher is better. */
  score: number;
  /** Which indexed fields matched: `title`, `body`, or both. */
  matchedFields: string[];
  areaId: Id | null;
  updatedAt: string;
}

export interface SearchService {
  /** Which engine answers; the UI never branches on it, tests and diagnostics do. */
  readonly backend: 'minisearch' | 'fts5';
  /** Resolves once the index reflects the repository (the first build). */
  ready(): Promise<void>;
  /**
   * Find records. `query` may carry `type:` and `area:` filters; explicit
   * `filters` win over parsed ones. A blank query returns no hits.
   */
  search(query: string, filters?: SearchFilters, limit?: number): Promise<SearchHit[]>;
  /** Fold repository changes since the last pass into the index. Concurrent calls coalesce. */
  refresh(): Promise<void>;
  /** Forget the change cursor so the next refresh rebuilds from live records (import, restore). */
  invalidate(): void;
  close?(): Promise<void>;
}

/** What the ranking needs to know about a candidate, before the full hit is built. */
export interface Rankable {
  titleMatched: boolean;
  score: number;
  updatedAt: string;
  id: Id;
}

/**
 * The one ranking rule: a title match outranks a body match, then the
 * backend's score, then the most recently edited record, then the id so
 * two runs order ties the same way.
 */
export function compareRank(a: Rankable, b: Rankable): number {
  return (
    Number(b.titleMatched) - Number(a.titleMatched) ||
    b.score - a.score ||
    (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function rankHits<T extends SearchHit>(hits: readonly T[]): T[] {
  return [...hits].sort((a, b) =>
    compareRank(
      { ...a, titleMatched: a.matchedFields.includes('title') },
      { ...b, titleMatched: b.matchedFields.includes('title') },
    ),
  );
}
