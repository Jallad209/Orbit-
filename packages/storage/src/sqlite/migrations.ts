import type { StoreName } from '../repository';
import type { SqlDriver } from './driver';
import { transactionalDriver } from './transactions';

/**
 * Forward-only migrations keyed by `PRAGMA user_version`. Never edit a
 * shipped migration; add the next one. An upgrade runs in one owned transaction.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Every record lives as JSON in `data`; indexed fields are generated columns
 * over it. Each migration's store inventory is a frozen literal: adding a
 * store to the Repository type must never widen an older migration's
 * generated table list, so the emitted SQL of a shipped version cannot drift.
 */
const V1_STORES = [
  'areas',
  'goals',
  'projects',
  'milestones',
  'tasks',
  'events',
  'routines',
  'routineInstances',
  'notes',
  'people',
  'commitments',
  'bills',
  'blocks',
  'dayCommitments',
  'sessions',
  'rules',
  'insightStates',
  'captures',
  'links',
] as const satisfies readonly StoreName[];
type V1Store = (typeof V1_STORES)[number];
const INDEXED_V1: Record<V1Store, string[]> = {
  areas: [],
  goals: ['areaId', 'status'],
  projects: ['areaId', 'goalId', 'status'],
  milestones: ['projectId'],
  tasks: ['projectId', 'areaId', 'status', 'dueAt'],
  events: ['startAt'],
  routines: ['areaId'],
  routineInstances: ['routineId', 'date'],
  notes: ['projectId', 'areaId'],
  people: [],
  commitments: ['personId', 'status'],
  bills: ['dueAt', 'paid'],
  blocks: ['date', 'taskId'],
  dayCommitments: ['date'],
  sessions: ['taskId', 'startAt'],
  rules: ['type'],
  insightStates: ['insightKey'],
  captures: ['status', 'type'],
  links: ['fromType', 'fromId', 'toType', 'toId'],
};

/** Stores added in 0002 (week 9). */
const V2_STORES = ['reminders', 'appSettings'] as const satisfies readonly StoreName[];
const INDEXED_V2: Record<(typeof V2_STORES)[number], string[]> = {
  reminders: ['key', 'status', 'fireAt'],
  appSettings: [],
};

/** Stores added in 0003 (week 12). */
const V3_STORES = ['weeklyReviews', 'weeklyReviewActions'] as const satisfies readonly StoreName[];
const INDEXED_V3: Record<(typeof V3_STORES)[number], string[]> = {
  weeklyReviews: ['reviewWeekStart', 'status'],
  weeklyReviewActions: ['reviewId', 'at'],
};

/** Which tables a file at `version` holds: what a restore verifier may expect of it. */
export function tablesAtVersion(version: number): StoreName[] {
  const out: StoreName[] = [...V1_STORES];
  if (version >= 2) out.push(...V2_STORES);
  if (version >= 3) out.push(...V3_STORES);
  return out;
}

function table(name: StoreName, fields: string[]): string {
  const generated = ['deletedAt', 'updatedAt', ...fields]
    .map((f) => `  ${f} TEXT GENERATED ALWAYS AS (json_extract(data, '$.${f}')) VIRTUAL`)
    .join(',\n');
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_${name}_deletedAt ON ${name}(deletedAt);`,
    ...fields.map((f) => `CREATE INDEX IF NOT EXISTS idx_${name}_${f} ON ${name}(${f});`),
  ];
  return [
    `CREATE TABLE IF NOT EXISTS ${name} (`,
    `  id TEXT PRIMARY KEY NOT NULL,`,
    `  data TEXT NOT NULL,`,
    generated,
    `);`,
    ...indexes,
  ].join('\n');
}

const INIT = [
  '-- 0001_init: one table per store, JSON in `data`, generated columns for indexes.',
  ...V1_STORES.map((n) => table(n, INDEXED_V1[n])),
  `CREATE INDEX IF NOT EXISTS idx_links_from ON links(fromType, fromId);`,
  `CREATE INDEX IF NOT EXISTS idx_links_to ON links(toType, toId);`,
  `CREATE TABLE IF NOT EXISTS opLog (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entityId TEXT NOT NULL,
  op TEXT NOT NULL,
  patch TEXT NOT NULL,
  at TEXT NOT NULL
);`,
  `CREATE INDEX IF NOT EXISTS idx_opLog_entity ON opLog(entity, entityId);`,
].join('\n\n');

const REMINDERS = [
  '-- 0002_reminders: the reminder queue and the one-row settings document.',
  ...V2_STORES.map((n) => table(n, INDEXED_V2[n])),
].join('\n\n');

const WEEKLY_REVIEWS = [
  '-- 0003_weekly_reviews: weekly reviews and their action receipts.',
  ...V3_STORES.map((n) => table(n, INDEXED_V3[n])),
].join('\n\n');

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '0001_init', sql: INIT },
  { version: 2, name: '0002_reminders', sql: REMINDERS },
  { version: 3, name: '0003_weekly_reviews', sql: WEEKLY_REVIEWS },
];

export const SQLITE_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export async function currentVersion(driver: SqlDriver): Promise<number> {
  const rows = await driver.select<{ user_version: number }>('PRAGMA user_version');
  return Number(rows[0]?.user_version ?? 0);
}

export interface MigrationReport {
  from: number;
  to: number;
  applied: string[];
}

/** Apply every migration newer than the file's version, oldest first. */
export async function migrate(
  driver: SqlDriver,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<MigrationReport> {
  return transactionalDriver(driver).transaction(async (tx) => {
    const from = await currentVersion(tx);
    const target = migrations[migrations.length - 1]?.version ?? 0;
    if (from > target) {
      throw new Error(
        `This data file was written by a newer Orbit (schema ${from}, this app reads ${target}). Update Orbit first.`,
      );
    }
    const applied: string[] = [];
    for (const m of migrations) {
      if (m.version <= from) continue;
      await tx.exec(m.sql);
      await tx.exec(`PRAGMA user_version = ${m.version}`);
      applied.push(m.name);
    }
    return { from, to: target, applied };
  });
}
