import type { Clock } from '@orbit/core';
import { createIndexedDbRepository, type IndexedDbRepositoryOptions } from './indexeddb';
import { createMemoryRepository } from './memory';
import type { Repository } from './repository';

export type RepositoryConfig =
  { kind: 'memory'; clock?: Clock } | ({ kind: 'indexeddb' } & IndexedDbRepositoryOptions);

/**
 * The one place a runtime chooses its storage. The app's `Platform`
 * implementations call this; nothing else constructs an adapter directly.
 * SQLite joins here in week 7.
 */
export async function openRepository(config: RepositoryConfig): Promise<Repository> {
  switch (config.kind) {
    case 'memory':
      return createMemoryRepository({ clock: config.clock });
    case 'indexeddb':
      return createIndexedDbRepository({
        name: config.name,
        clock: config.clock,
        indexedDB: config.indexedDB,
        IDBKeyRange: config.IDBKeyRange,
      });
  }
}
