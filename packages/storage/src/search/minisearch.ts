import MiniSearch, { type SearchResult } from 'minisearch';
import type { Id, OpLogEntry } from '@orbit/core';
import type { Repository } from '../repository';
import {
  loadSearchSnapshot,
  lookupsFor,
  noteDocument,
  personDocument,
  projectDocument,
  taskDocument,
  toSearchDocuments,
  type SearchDocument,
  type SearchLookups,
} from './documents';
import { mergeFilters, parseSearchQuery, queryTerms, tokenizeText } from './query';
import {
  FUZZY_MAX,
  FUZZY_RATE,
  makeSnippet,
  matchedFieldsFor,
  maxEditDistance,
  termMatcher,
} from './terms';
import { compareRank, type SearchFilters, type SearchHit, type SearchService } from './types';

/**
 * In-process index on MiniSearch: the web runtime's search, and the
 * desktop's fallback when the bundled SQLite has no FTS5. Built from live
 * records, then kept current from the op log: each pass applies the entries
 * since its cursor and only advances the cursor once they are in. A pass
 * that fails leaves the previous index answering and schedules a rebuild.
 */

/** Bump when the document shape or tokenizer changes, so a saved index is not trusted. */
export const MINISEARCH_INDEX_VERSION = 1;
/** Above this many pending op-log entries a rebuild is cheaper than replaying. */
export const REBUILD_THRESHOLD = 500;

const FIELDS = ['title', 'body'];
const STORED = ['type', 'title', 'body', 'areaId', 'updatedAt'];

const OPTIONS = {
  fields: FIELDS,
  storeFields: STORED,
  idField: 'id',
  tokenize: tokenizeText,
  processTerm: (term: string) => term,
  searchOptions: {
    prefix: true,
    fuzzy: (term: string) => (maxEditDistance(term) > 0 ? FUZZY_RATE : false),
    maxFuzzy: FUZZY_MAX,
    boost: { title: 3 },
    combineWith: 'OR' as const,
  },
};

function newIndex(): MiniSearch<SearchDocument> {
  return new MiniSearch<SearchDocument>(OPTIONS);
}

export interface MiniSearchServiceOptions {
  repo: Repository;
  /** A previous `serialize()` result to start from; ignored when stale or unreadable. */
  serialized?: string;
  rebuildThreshold?: number;
}

export interface MiniSearchStats {
  documents: number;
  cursor: number | null;
  lastError: string | null;
}

export interface MiniSearchService extends SearchService {
  readonly backend: 'minisearch';
  serialize(): string;
  stats(): MiniSearchStats;
}

interface Serialized {
  version: number;
  cursor: number | null;
  areas: Array<{ id: Id; name: string }>;
  projects: Array<{ id: Id; title: string }>;
  index: ReturnType<MiniSearch['toJSON']>;
}

const SEARCHABLE = new Set(['task', 'note', 'project', 'person', 'area']);

export function createMiniSearchService(options: MiniSearchServiceOptions): MiniSearchService {
  const { repo } = options;
  const threshold = options.rebuildThreshold ?? REBUILD_THRESHOLD;

  let index = newIndex();
  let lookups: SearchLookups = { areaNames: new Map(), projectTitles: new Map() };
  let areas: Array<{ id: Id; name: string }> = [];
  /** Op-log seq the index reflects; null means "rebuild from live records". */
  let cursor: number | null = null;
  let lastError: string | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  let first: Promise<void> | null = null;

  if (options.serialized) restore(options.serialized);

  function restore(serialized: string): void {
    try {
      const data = JSON.parse(serialized) as Serialized;
      if (data.version !== MINISEARCH_INDEX_VERSION || typeof data.cursor !== 'number') return;
      const loaded = MiniSearch.loadJS<SearchDocument>(data.index, OPTIONS);
      index = loaded;
      areas = data.areas;
      lookups = {
        areaNames: new Map(data.areas.map((a) => [a.id, a.name])),
        projectTitles: new Map(data.projects.map((p) => [p.id, p.title])),
      };
      cursor = data.cursor;
    } catch {
      cursor = null;
    }
  }

  async function rebuild(): Promise<void> {
    // Read the cursor before the records: anything written in between is
    // replayed by the next pass, and replaying is idempotent.
    const latest = await repo.opLog.latestSeq();
    const snapshot = await loadSearchSnapshot(repo);
    const fresh = newIndex();
    await fresh.addAllAsync(toSearchDocuments(snapshot), { chunkSize: 1000 });
    index = fresh;
    lookups = lookupsFor(snapshot.areas, snapshot.projects);
    areas = snapshot.areas.map((a) => ({ id: a.id, name: a.name }));
    cursor = latest;
    lastError = null;
  }

  function put(doc: SearchDocument): void {
    if (index.has(doc.id)) index.replace(doc);
    else index.add(doc);
  }

  function drop(id: Id): void {
    if (index.has(id)) index.discard(id);
  }

  async function reindexTask(id: Id): Promise<void> {
    const task = await repo.tasks.get(id);
    if (!task || task.deletedAt !== null) drop(id);
    else put(taskDocument(task, lookups));
  }

  async function reindexNote(id: Id): Promise<void> {
    const note = await repo.notes.get(id);
    if (!note || note.deletedAt !== null) drop(id);
    else put(noteDocument(note));
  }

  async function reindexProject(id: Id): Promise<void> {
    const project = await repo.projects.get(id);
    if (!project || project.deletedAt !== null) {
      lookups.projectTitles.delete(id);
      drop(id);
    } else {
      lookups.projectTitles.set(id, project.title);
      put(projectDocument(project, lookups));
    }
    // Tasks carry the project title in their body.
    for (const t of await repo.tasks.query((t) => t.projectId === id))
      put(taskDocument(t, lookups));
  }

  async function reindexPerson(id: Id): Promise<void> {
    const person = await repo.people.get(id);
    if (!person || person.deletedAt !== null) drop(id);
    else put(personDocument(person));
  }

  async function reindexArea(id: Id): Promise<void> {
    const area = await repo.areas.get(id);
    if (!area || area.deletedAt !== null) {
      lookups.areaNames.delete(id);
      areas = areas.filter((a) => a.id !== id);
    } else {
      lookups.areaNames.set(id, area.name);
      areas = [...areas.filter((a) => a.id !== id), { id, name: area.name }];
    }
    // Tasks and projects carry the area name in their body.
    for (const t of await repo.tasks.query((t) => t.areaId === id)) put(taskDocument(t, lookups));
    for (const p of await repo.projects.query((p) => p.areaId === id))
      put(projectDocument(p, lookups));
  }

  async function apply(ops: readonly OpLogEntry[]): Promise<void> {
    // One pass per record: the last entry decides, and a fetch shows the truth anyway.
    const seen = new Map<string, OpLogEntry>();
    for (const op of ops)
      if (SEARCHABLE.has(op.entity)) seen.set(`${op.entity}:${op.entityId}`, op);
    // Areas and projects first: they change what other documents say.
    const order = ['area', 'project', 'task', 'note', 'person'];
    const sorted = [...seen.values()].sort(
      (a, b) => order.indexOf(a.entity) - order.indexOf(b.entity),
    );
    for (const op of sorted) {
      if (op.entity === 'area') await reindexArea(op.entityId);
      else if (op.entity === 'project') await reindexProject(op.entityId);
      else if (op.entity === 'task') await reindexTask(op.entityId);
      else if (op.entity === 'note') await reindexNote(op.entityId);
      else if (op.entity === 'person') await reindexPerson(op.entityId);
    }
  }

  async function pass(): Promise<void> {
    if (cursor === null) {
      await rebuild();
      return;
    }
    const from = cursor;
    const ops = await repo.opLog.since(from, threshold + 1);
    if (!ops.length) return;
    if (ops.length > threshold) {
      await rebuild();
      return;
    }
    try {
      await apply(ops);
      cursor = ops[ops.length - 1]!.seq;
      lastError = null;
    } catch (e) {
      // The old index keeps answering; the next refresh starts over.
      lastError = e instanceof Error ? e.message : String(e);
      cursor = null;
    }
  }

  function refresh(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await pass();
      } while (again);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  function toHit(r: SearchResult, matcher: ReturnType<typeof termMatcher>): SearchHit {
    const doc = r as unknown as SearchDocument;
    return {
      id: doc.id,
      type: doc.type,
      title: doc.title,
      snippet: makeSnippet(doc.body, matcher),
      score: r.score,
      matchedFields: matchedFieldsFor(doc, matcher),
      areaId: doc.areaId,
      updatedAt: doc.updatedAt,
    };
  }

  return {
    backend: 'minisearch',

    ready(): Promise<void> {
      first ??= refresh();
      return first;
    },

    async search(query: string, filters?: SearchFilters, limit = 20): Promise<SearchHit[]> {
      const parsed = parseSearchQuery(query, { areas });
      const f = mergeFilters(parsed.filters, filters);
      const terms = queryTerms(parsed.text);
      if (!terms.length) return [];
      const types = f.types?.length ? new Set<string>(f.types) : null;
      const results = index.search(terms.join(' '), {
        filter: (r) =>
          (!types || types.has(r.type as string)) && (!f.areaId || r.areaId === f.areaId),
      });
      // Rank every candidate on what the engine already knows; build only the
      // hits that will be shown (a common word can match tens of thousands).
      const top = results
        .map((r) => ({
          r,
          titleMatched: Object.values(r.match).some((fields) => fields.includes('title')),
          score: r.score,
          updatedAt: r.updatedAt as string,
          id: r.id as string,
        }))
        .sort(compareRank)
        .slice(0, limit);
      const matcher = termMatcher(
        parsed.text,
        top.flatMap(({ r }) => r.terms),
      );
      return top.map(({ r }) => toHit(r, matcher));
    },

    refresh,

    invalidate(): void {
      cursor = null;
    },

    serialize(): string {
      const data: Serialized = {
        version: MINISEARCH_INDEX_VERSION,
        cursor,
        areas,
        projects: [...lookups.projectTitles].map(([id, title]) => ({ id, title })),
        index: index.toJSON(),
      };
      return JSON.stringify(data);
    },

    stats(): MiniSearchStats {
      return { documents: index.documentCount, cursor, lastError };
    },
  };
}
