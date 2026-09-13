export * from './types';
export * from './query';
export * from './documents';
export * from './terms';
// The MiniSearch backend is its own entry (`@orbit/storage/search/minisearch`) so the
// library only loads on runtimes that use it; the factory imports it on demand.
export type { MiniSearchService, MiniSearchServiceOptions, MiniSearchStats } from './minisearch';
export * from './fts5';
export * from './factory';
