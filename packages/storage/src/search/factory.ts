import type { Repository } from '../repository';
import type { SqlDriver } from '../sqlite/driver';
import { createFts5SearchService, fts5Available } from './fts5';
import type { SearchService } from './types';

export interface SearchServiceConfig {
  repo: Repository;
  /** The SQLite driver behind `repo`, when there is one (desktop). */
  driver?: SqlDriver;
  /** Force the in-process index even when FTS5 is available. */
  preferMiniSearch?: boolean;
}

/**
 * The runtime's search: FTS5 inside the data file when the bundled SQLite
 * has it, MiniSearch in memory otherwise (the web, or an unusual SQLite).
 * Both honour the same contract; the choice is only about where the work
 * happens.
 */
export async function createSearchService(config: SearchServiceConfig): Promise<SearchService> {
  if (config.driver && !config.preferMiniSearch && (await fts5Available(config.driver))) {
    return createFts5SearchService({ driver: config.driver, repo: config.repo });
  }
  // Loaded only when needed: the desktop with FTS5 never pays for the library.
  const { createMiniSearchService } = await import('./minisearch');
  return createMiniSearchService({ repo: config.repo });
}
