import type { Id } from '@orbit/core';
import type { Repository } from '../repository';
import type { SqlDriver, SqlParam } from '../sqlite/driver';
import { transactionalDriver } from '../sqlite/transactions';
import { mergeFilters, parseSearchQuery, queryTerms } from './query';
import { editDistance, matchedFieldsFor, maxEditDistance, termMatcher } from './terms';
import { rankHits, type SearchFilters, type SearchHit, type SearchService } from './types';

/**
 * Desktop search on SQLite FTS5. The index lives in the data file next to
 * the records, as a rebuildable cache: `search_fts` holds the same two
 * strings per record that `documents.ts` defines, triggers on the four
 * source tables keep it current inside the same transaction as the write,
 * and `search_meta` carries a schema marker so an older or damaged cache is
 * rebuilt rather than trusted. Nothing here is a migration: a data file
 * without these tables is a valid Orbit file, and one with them opens in an
 * older Orbit unchanged (the triggers keep working, unnoticed).
 */

/** Bump when the document shape, tokenizer, or trigger set changes. */
export const FTS_SCHEMA = 1;

const SOURCE = {
  task: 'tasks',
  note: 'notes',
  project: 'projects',
  person: 'people',
} as const;

type Type = keyof typeof SOURCE;

const TOKENIZER = "tokenize = 'unicode61 remove_diacritics 2'";

const FTS_COLUMNS = '(type, id, areaId, updatedAt, title, body)';

/** ` · `-joined non-blank parts, like `joinParts` in documents.ts. */
function sqlJoin(a: string, b: string): string {
  const A = `coalesce(${a}, '')`;
  const B = `coalesce(${b}, '')`;
  return (
    `(CASE WHEN trim(${A}) <> '' THEN ${A} ELSE '' END) || ` +
    `(CASE WHEN trim(${A}) <> '' AND trim(${B}) <> '' THEN ' · ' ELSE '' END) || ` +
    `(CASE WHEN trim(${B}) <> '' THEN ${B} ELSE '' END)`
  );
}

function areaName(row: string): string {
  return (
    `(SELECT json_extract(a.data, '$.name') FROM areas a ` +
    `WHERE a.id = json_extract(${row}.data, '$.areaId') AND json_extract(a.data, '$.deletedAt') IS NULL)`
  );
}

function projectTitle(row: string): string {
  return (
    `(SELECT json_extract(p.data, '$.title') FROM projects p ` +
    `WHERE p.id = json_extract(${row}.data, '$.projectId') AND json_extract(p.data, '$.deletedAt') IS NULL)`
  );
}

/** The document for one source row, as a SELECT list; `row` is the row alias (`new`, `t`). */
function documentSelect(type: Type, row: string): string {
  const field = (name: string) => `json_extract(${row}.data, '$.${name}')`;
  const title = type === 'person' ? field('name') : field('title');
  const body =
    type === 'task'
      ? sqlJoin(projectTitle(row), areaName(row))
      : type === 'note'
        ? `coalesce(${field('body')}, '')`
        : type === 'project'
          ? sqlJoin(field('outcome'), areaName(row))
          : `coalesce(${field('contact')}, '')`;
  const area = type === 'person' ? 'NULL' : field('areaId');
  return `SELECT '${type}', ${row}.id, ${area}, ${field('updatedAt')}, ${title}, ${body}`;
}

function insertFor(type: Type, row: string): string {
  return `INSERT INTO search_fts${FTS_COLUMNS} ${documentSelect(type, row)} WHERE json_extract(${row}.data, '$.deletedAt') IS NULL`;
}

function triggersFor(type: Type): string {
  const table = SOURCE[type];
  return [
    `CREATE TRIGGER IF NOT EXISTS search_${table}_ai AFTER INSERT ON ${table} BEGIN
  ${insertFor(type, 'new')};
END;`,
    `CREATE TRIGGER IF NOT EXISTS search_${table}_au AFTER UPDATE ON ${table} BEGIN
  DELETE FROM search_fts WHERE type = '${type}' AND id = old.id;
  ${insertFor(type, 'new')};
END;`,
    `CREATE TRIGGER IF NOT EXISTS search_${table}_ad AFTER DELETE ON ${table} BEGIN
  DELETE FROM search_fts WHERE type = '${type}' AND id = old.id;
END;`,
  ].join('\n');
}

/** A renamed project or area changes the body of every document that names it. */
const CASCADES = `
CREATE TRIGGER IF NOT EXISTS search_projects_cascade AFTER UPDATE ON projects
WHEN json_extract(old.data, '$.title') IS NOT json_extract(new.data, '$.title')
  OR json_extract(old.data, '$.deletedAt') IS NOT json_extract(new.data, '$.deletedAt')
BEGIN
  DELETE FROM search_fts WHERE type = 'task' AND id IN (SELECT id FROM tasks WHERE projectId = new.id);
  INSERT INTO search_fts${FTS_COLUMNS} ${documentSelect('task', 't')} FROM tasks t WHERE t.projectId = new.id AND t.deletedAt IS NULL;
END;
CREATE TRIGGER IF NOT EXISTS search_areas_cascade AFTER UPDATE ON areas
WHEN json_extract(old.data, '$.name') IS NOT json_extract(new.data, '$.name')
  OR json_extract(old.data, '$.deletedAt') IS NOT json_extract(new.data, '$.deletedAt')
BEGIN
  DELETE FROM search_fts WHERE type IN ('task', 'project') AND id IN (
    SELECT id FROM tasks WHERE areaId = new.id UNION SELECT id FROM projects WHERE areaId = new.id);
  INSERT INTO search_fts${FTS_COLUMNS} ${documentSelect('task', 't')} FROM tasks t WHERE t.areaId = new.id AND t.deletedAt IS NULL;
  INSERT INTO search_fts${FTS_COLUMNS} ${documentSelect('project', 'p')} FROM projects p WHERE p.areaId = new.id AND p.deletedAt IS NULL;
END;`;

/** Everything `CREATE` makes, by name; a missing piece means writes went unindexed. */
const EXPECTED_OBJECTS = [
  'search_fts',
  'search_vocab',
  'search_meta',
  ...(Object.values(SOURCE) as string[]).flatMap((t) => [
    `search_${t}_ai`,
    `search_${t}_au`,
    `search_${t}_ad`,
  ]),
  'search_projects_cascade',
  'search_areas_cascade',
];

const CREATE = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(type UNINDEXED, id UNINDEXED, areaId UNINDEXED, updatedAt UNINDEXED, title, body, ${TOKENIZER});`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS search_vocab USING fts5vocab('search_fts', 'row');`,
  `CREATE TABLE IF NOT EXISTS search_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);`,
  ...(Object.keys(SOURCE) as Type[]).map(triggersFor),
  CASCADES,
].join('\n');

const BACKFILL = [
  'DELETE FROM search_fts;',
  ...(Object.keys(SOURCE) as Type[]).map(
    (type) =>
      `INSERT INTO search_fts${FTS_COLUMNS} ${documentSelect(type, 'r')} FROM ${SOURCE[type]} r WHERE r.deletedAt IS NULL;`,
  ),
].join('\n');

/**
 * Whether this SQLite can do FTS5, proven by creating a virtual table in
 * the `temp` schema: no user data is touched and nothing is left behind.
 */
export async function fts5Available(driver: SqlDriver): Promise<boolean> {
  try {
    await driver.exec(
      'CREATE VIRTUAL TABLE IF NOT EXISTS temp.orbit_fts5_probe USING fts5(x); DROP TABLE temp.orbit_fts5_probe;',
    );
    return true;
  } catch {
    return false;
  }
}

export interface Fts5ServiceOptions {
  driver: SqlDriver;
  repo: Repository;
}

export interface Fts5Stats {
  documents: number;
  schema: number | null;
  rebuilds: number;
}

export interface Fts5SearchService extends SearchService {
  readonly backend: 'fts5';
  stats(): Promise<Fts5Stats>;
}

interface Row {
  type: Type;
  id: Id;
  areaId: Id | null;
  updatedAt: string;
  title: string;
  body: string;
  score: number;
  snip: string | null;
}

const WEIGHTS = 'bm25(search_fts, 0, 0, 0, 0, 3.0, 1.0)';

export function createFts5SearchService(options: Fts5ServiceOptions): Fts5SearchService {
  // The same queue the repository uses, so index work never interleaves
  // with a transaction the UI or the scheduler owns.
  const driver = transactionalDriver(options.driver);
  const { repo } = options;
  let first: Promise<void> | null = null;
  let running: Promise<void> | null = null;
  let stale = true;
  let rebuilds = 0;

  async function schemaMarker(db: SqlDriver): Promise<number | null> {
    try {
      const rows = await db.select<{ value: string }>(
        "SELECT value FROM search_meta WHERE key = 'schema'",
      );
      return rows[0] ? Number(rows[0].value) : null;
    } catch {
      return null; // no cache tables yet
    }
  }

  async function dropAll(db: SqlDriver): Promise<void> {
    const triggers = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_schema WHERE type = 'trigger' AND name LIKE 'search\\_%' ESCAPE '\\'",
    );
    for (const t of triggers) await db.exec(`DROP TRIGGER IF EXISTS "${t.name}"`);
    await db.exec(
      'DROP TABLE IF EXISTS search_vocab; DROP TABLE IF EXISTS search_fts; DROP TABLE IF EXISTS search_meta;',
    );
  }

  async function rebuild(db: SqlDriver): Promise<void> {
    await dropAll(db);
    await db.exec(CREATE);
    await db.exec(BACKFILL);
    await db.execute("INSERT OR REPLACE INTO search_meta(key, value) VALUES ('schema', ?)", [
      String(FTS_SCHEMA),
    ]);
    rebuilds += 1;
  }

  /**
   * Cheap drift check: every table and trigger present, one live-row count
   * per source table against the cache, then FTS5's own integrity check.
   */
  async function consistent(db: SqlDriver): Promise<boolean> {
    const present = new Set(
      (
        await db.select<{ name: string }>(
          "SELECT name FROM sqlite_schema WHERE name LIKE 'search\\_%' ESCAPE '\\'",
        )
      ).map((r) => r.name),
    );
    if (!EXPECTED_OBJECTS.every((name) => present.has(name))) return false;
    for (const type of Object.keys(SOURCE) as Type[]) {
      const [src, idx] = await Promise.all([
        db.select<{ c: number }>(
          `SELECT count(*) AS c FROM ${SOURCE[type]} WHERE deletedAt IS NULL`,
        ),
        db.select<{ c: number }>(`SELECT count(*) AS c FROM search_fts WHERE type = ?`, [type]),
      ]);
      if (Number(src[0]?.c ?? 0) !== Number(idx[0]?.c ?? 0)) return false;
    }
    try {
      await db.exec("INSERT INTO search_fts(search_fts) VALUES ('integrity-check')");
    } catch {
      return false;
    }
    return true;
  }

  async function ensure(): Promise<void> {
    await driver.transaction(async (tx) => {
      const marker = await schemaMarker(tx);
      if (marker !== FTS_SCHEMA || !(await consistent(tx))) await rebuild(tx);
    });
    stale = false;
  }

  function refresh(): Promise<void> {
    if (!stale) return Promise.resolve();
    running ??= ensure().finally(() => {
      running = null;
    });
    return running;
  }

  /** Whole index terms within the typo budget of `term`, for the MATCH expression. */
  async function expansions(term: string): Promise<string[]> {
    const budget = maxEditDistance(term);
    if (budget === 0) return [];
    const rows = await driver.select<{ term: string }>(
      'SELECT term FROM search_vocab WHERE length(term) BETWEEN ? AND ?',
      [term.length - budget, term.length + budget],
    );
    return rows
      .map((r) => r.term)
      .filter((t) => t !== term && !t.startsWith(term) && editDistance(term, t, budget) <= budget)
      .sort()
      .slice(0, 8);
  }

  return {
    backend: 'fts5',

    ready(): Promise<void> {
      first ??= refresh();
      return first;
    },

    async search(query: string, filters?: SearchFilters, limit = 20): Promise<SearchHit[]> {
      const areas = await repo.areas.list();
      const parsed = parseSearchQuery(query, { areas });
      const f = mergeFilters(parsed.filters, filters);
      const terms = queryTerms(parsed.text);
      if (!terms.length) return [];

      const fuzzy = new Set<string>();
      const clauses: string[] = [];
      for (const term of terms) {
        const more = await expansions(term);
        for (const m of more) fuzzy.add(m);
        clauses.push(`(${[`"${term}"*`, ...more.map((m) => `"${m}"`)].join(' OR ')})`);
      }
      const params: SqlParam[] = [clauses.join(' OR ')];
      let where = 'search_fts MATCH ?';
      if (f.types?.length) {
        where += ` AND type IN (${f.types.map(() => '?').join(', ')})`;
        params.push(...f.types);
      }
      if (f.areaId) {
        where += ' AND areaId = ?';
        params.push(f.areaId);
      }
      params.push(Math.max(limit * 3, 50));
      const rows = await driver.select<Row>(
        `SELECT type, id, areaId, updatedAt, title, body, -${WEIGHTS} AS score, ` +
          `snippet(search_fts, 5, '', '', '…', 16) AS snip ` +
          `FROM search_fts WHERE ${where} ORDER BY ${WEIGHTS} LIMIT ?`,
        params,
      );
      const matcher = termMatcher(parsed.text, fuzzy);
      return rankHits(
        rows.map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          snippet: (r.snip ?? '').replace(/\s+/gu, ' ').trim(),
          score: Number(r.score),
          matchedFields: matchedFieldsFor(r, matcher),
          areaId: r.areaId,
          updatedAt: r.updatedAt,
        })),
      ).slice(0, limit);
    },

    refresh,

    invalidate(): void {
      stale = true;
    },

    async stats(): Promise<Fts5Stats> {
      const [count, schema] = await Promise.all([
        driver
          .select<{ c: number }>('SELECT count(*) AS c FROM search_fts')
          .then((r) => Number(r[0]?.c ?? 0))
          .catch(() => 0),
        schemaMarker(driver),
      ]);
      return { documents: count, schema, rebuilds };
    },
  };
}
