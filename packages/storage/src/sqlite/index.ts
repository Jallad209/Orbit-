import type { z } from 'zod';
import {
  AreaSchema,
  BillSchema,
  BlockSchema,
  CaptureSchema,
  CommitmentSchema,
  DayCommitmentSchema,
  EventSchema,
  GoalSchema,
  InsightStateSchema,
  LinkSchema,
  MilestoneSchema,
  NoteSchema,
  PersonSchema,
  ProjectSchema,
  RoutineInstanceSchema,
  RoutineSchema,
  RuleSchema,
  SessionSchema,
  TaskSchema,
  nowIso,
  shallowPatch,
  systemClock,
} from '@orbit/core';
import type { BaseRecord, Clock, EntityType, Id, Link, Op, OpLogEntry } from '@orbit/core';
import type {
  EntityStore,
  LinkStore,
  ListOptions,
  OpLogReader,
  Repository,
  StoreName,
  UpsertOptions,
} from '../repository';
import { STORE_ENTITY } from '../repository';
import type { SqlDriver, SqlParam } from './driver';
import { migrate } from './migrations';

export * from './driver';
export * from './migrations';

interface Ctx {
  driver: SqlDriver;
  clock: Clock;
  depth: number;
}

/** Run `fn` inside the current transaction, or open one for it. */
async function withTx<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  if (ctx.depth > 0) return fn();
  ctx.depth += 1;
  let began = false;
  try {
    await ctx.driver.exec('BEGIN IMMEDIATE');
    began = true;
    const out = await fn();
    await ctx.driver.exec('COMMIT');
    return out;
  } catch (e) {
    if (began) await ctx.driver.exec('ROLLBACK');
    throw e;
  } finally {
    ctx.depth -= 1;
  }
}

class SqliteStore<T extends BaseRecord> implements EntityStore<T> {
  constructor(
    protected readonly name: StoreName,
    protected readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    protected readonly ctx: Ctx,
  ) {}

  protected get entity(): EntityType {
    return STORE_ENTITY[this.name];
  }

  protected parse(rows: Array<{ data: string }>): T[] {
    return rows.map((r) => JSON.parse(r.data) as T);
  }

  protected async log(op: Op, entityId: Id, patch: Record<string, unknown>): Promise<void> {
    await this.ctx.driver.execute(
      'INSERT INTO opLog(entity, entityId, op, patch, at) VALUES (?, ?, ?, ?, ?)',
      [this.entity, entityId, op, JSON.stringify(patch), nowIso(this.ctx.clock)],
    );
  }

  async get(id: Id): Promise<T | undefined> {
    const rows = await this.ctx.driver.select<{ data: string }>(
      `SELECT data FROM ${this.name} WHERE id = ?`,
      [id],
    );
    return this.parse(rows)[0];
  }

  async getMany(ids: readonly Id[]): Promise<T[]> {
    const found = new Map<Id, T>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = await this.ctx.driver.select<{ data: string }>(
        `SELECT data FROM ${this.name} WHERE id IN (${chunk.map(() => '?').join(',')})`,
        chunk,
      );
      for (const r of this.parse(rows)) found.set(r.id, r);
    }
    return ids.map((id) => found.get(id)).filter((r): r is T => r !== undefined);
  }

  async list(options?: ListOptions): Promise<T[]> {
    const where = options?.includeDeleted ? '' : ' WHERE deletedAt IS NULL';
    return this.parse(
      await this.ctx.driver.select<{ data: string }>(`SELECT data FROM ${this.name}${where}`),
    );
  }

  async query(predicate: (record: T) => boolean, options?: ListOptions): Promise<T[]> {
    return (await this.list(options)).filter(predicate);
  }

  async count(options?: ListOptions): Promise<number> {
    const where = options?.includeDeleted ? '' : ' WHERE deletedAt IS NULL';
    const rows = await this.ctx.driver.select<{ c: number }>(
      `SELECT count(*) AS c FROM ${this.name}${where}`,
    );
    return Number(rows[0]?.c ?? 0);
  }

  async upsert(record: T, options?: UpsertOptions): Promise<T> {
    const updatedAt = options?.preserveUpdatedAt ? record.updatedAt : nowIso(this.ctx.clock);
    const stamped = this.schema.parse({ ...record, updatedAt });
    return withTx(this.ctx, async () => {
      const prev = await this.get(stamped.id);
      await this.ctx.driver.execute(
        `INSERT INTO ${this.name}(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        [stamped.id, JSON.stringify(stamped)],
      );
      if (prev) {
        await this.log(
          'update',
          stamped.id,
          shallowPatch(prev, stamped) as Record<string, unknown>,
        );
      } else {
        await this.log('create', stamped.id, { ...stamped });
      }
      return stamped;
    });
  }

  async softDelete(id: Id): Promise<void> {
    await withTx(this.ctx, async () => {
      const prev = await this.get(id);
      if (!prev || prev.deletedAt !== null) return;
      const at = nowIso(this.ctx.clock);
      await this.ctx.driver.execute(`UPDATE ${this.name} SET data = ? WHERE id = ?`, [
        JSON.stringify({ ...prev, deletedAt: at, updatedAt: at }),
        id,
      ]);
      await this.log('delete', id, { deletedAt: at });
    });
  }
}

class SqliteLinkStore extends SqliteStore<Link> implements LinkStore {
  async forEntity(type: EntityType, id: Id): Promise<Link[]> {
    return this.parse(
      await this.ctx.driver.select<{ data: string }>(
        `SELECT data FROM links WHERE deletedAt IS NULL AND ((fromType = ? AND fromId = ?) OR (toType = ? AND toId = ?))`,
        [type, id, type, id],
      ),
    );
  }
}

interface OpLogRow {
  seq: number;
  entity: EntityType;
  entityId: string;
  op: Op;
  patch: string;
  at: string;
}

class SqliteOpLog implements OpLogReader {
  constructor(private readonly ctx: Ctx) {}

  async since(afterSeq: number, limit?: number): Promise<OpLogEntry[]> {
    const params: SqlParam[] = [afterSeq];
    let sql = 'SELECT seq, entity, entityId, op, patch, at FROM opLog WHERE seq > ? ORDER BY seq';
    if (limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(limit);
    }
    const rows = await this.ctx.driver.select<OpLogRow>(sql, params);
    return rows.map((r) => ({ ...r, seq: Number(r.seq), patch: JSON.parse(r.patch) }));
  }

  async latestSeq(): Promise<number> {
    const rows = await this.ctx.driver.select<{ seq: number | null }>(
      'SELECT max(seq) AS seq FROM opLog',
    );
    return Number(rows[0]?.seq ?? 0);
  }
}

export interface SqliteRepositoryOptions {
  driver: SqlDriver;
  clock?: Clock;
  /** Skip migrations (tests that build the schema themselves). Default false. */
  skipMigrations?: boolean;
}

/**
 * Desktop repository on SQLite. Passes the same contract suite as the memory
 * and IndexedDB adapters. WAL mode with `synchronous=NORMAL` keeps writes
 * durable across crashes while staying fast; transactions are real
 * `BEGIN IMMEDIATE` blocks on the single connection.
 */
export async function createSqliteRepository(
  options: SqliteRepositoryOptions,
): Promise<Repository> {
  const ctx: Ctx = { driver: options.driver, clock: options.clock ?? systemClock, depth: 0 };
  await ctx.driver.select('PRAGMA journal_mode = WAL');
  await ctx.driver.exec('PRAGMA synchronous = NORMAL');
  await ctx.driver.exec('PRAGMA foreign_keys = ON');
  if (!options.skipMigrations) await migrate(ctx.driver);

  const repo: Repository = {
    areas: new SqliteStore('areas', AreaSchema, ctx),
    goals: new SqliteStore('goals', GoalSchema, ctx),
    projects: new SqliteStore('projects', ProjectSchema, ctx),
    milestones: new SqliteStore('milestones', MilestoneSchema, ctx),
    tasks: new SqliteStore('tasks', TaskSchema, ctx),
    events: new SqliteStore('events', EventSchema, ctx),
    routines: new SqliteStore('routines', RoutineSchema, ctx),
    routineInstances: new SqliteStore('routineInstances', RoutineInstanceSchema, ctx),
    notes: new SqliteStore('notes', NoteSchema, ctx),
    people: new SqliteStore('people', PersonSchema, ctx),
    commitments: new SqliteStore('commitments', CommitmentSchema, ctx),
    bills: new SqliteStore('bills', BillSchema, ctx),
    blocks: new SqliteStore('blocks', BlockSchema, ctx),
    dayCommitments: new SqliteStore('dayCommitments', DayCommitmentSchema, ctx),
    sessions: new SqliteStore('sessions', SessionSchema, ctx),
    rules: new SqliteStore('rules', RuleSchema, ctx),
    insightStates: new SqliteStore('insightStates', InsightStateSchema, ctx),
    captures: new SqliteStore('captures', CaptureSchema, ctx),
    links: new SqliteLinkStore('links', LinkSchema, ctx),
    opLog: new SqliteOpLog(ctx),

    async transaction<T>(fn: (tx: Repository) => Promise<T>): Promise<T> {
      return withTx(ctx, () => fn(repo));
    },

    async close(): Promise<void> {
      await ctx.driver.close();
    },
  };
  return repo;
}

export interface IntegrityResult {
  ok: boolean;
  /** `ok`, or what SQLite reported; the open error when the file is not a database. */
  messages: string[];
  /** Whether the bundled SQLite can do full-text search (week 10). */
  fts5: boolean;
}

/** `PRAGMA integrity_check`, plus FTS5 detection, on an open connection. */
export async function integrityCheck(driver: SqlDriver): Promise<IntegrityResult> {
  let fts5 = false;
  try {
    const opts = await driver.select<{ compile_options: string }>('PRAGMA compile_options');
    fts5 = opts.some((o) => o.compile_options === 'ENABLE_FTS5');
  } catch {
    /* older builds without the pragma */
  }
  try {
    const rows = await driver.select<{ integrity_check: string }>('PRAGMA integrity_check');
    const messages = rows.map((r) => r.integrity_check);
    return { ok: messages.length === 1 && messages[0] === 'ok', messages, fts5 };
  } catch (e) {
    return { ok: false, messages: [e instanceof Error ? e.message : String(e)], fts5 };
  }
}

export interface BackupCandidate {
  path: string;
  /** ISO instant or anything that sorts chronologically. */
  modifiedAt: string;
  sizeBytes: number;
}

/**
 * Which backup to restore when the data file is corrupt: the newest one
 * that is not empty. Returns null when there is nothing to restore from,
 * in which case the corrupt file is renamed aside and a fresh one created.
 */
export function chooseRestore(backups: readonly BackupCandidate[]): BackupCandidate | null {
  const usable = backups.filter((b) => b.sizeBytes > 0);
  if (!usable.length) return null;
  return [...usable].sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1))[0]!;
}
