import type { z } from 'zod';
import {
  AppSettingsSchema,
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
  ReminderSchema,
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
  DeleteOptions,
  EntityStore,
  LinkStore,
  ListOptions,
  OpLogReader,
  Repository,
  StoreName,
  UpsertOptions,
} from '../repository';
import { STORE_ENTITY } from '../repository';
import { normalizerFor } from '../normalize';
import type { SqlDriver, SqlParam } from './driver';
import { migrate } from './migrations';
import { transactionalDriver } from './transactions';

export * from './driver';
export * from './migrations';

interface Ctx {
  driver: SqlDriver;
  clock: Clock;
  inTransaction: boolean;
}

/** Run `fn` inside the current transaction, or open one for it. */
async function withTx<T>(ctx: Ctx, fn: (tx: Ctx) => Promise<T>): Promise<T> {
  if (ctx.inTransaction) return fn(ctx);
  return transactionalDriver(ctx.driver).transaction((driver) =>
    fn({ ...ctx, driver, inTransaction: true }),
  );
}

class SqliteStore<T extends BaseRecord> implements EntityStore<T> {
  /** Week-11 read normalization for the stores whose shape grew; identity elsewhere. */
  private readonly normalize: ((raw: T) => T) | null;

  constructor(
    protected readonly name: StoreName,
    protected readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    protected readonly ctx: Ctx,
  ) {
    this.normalize = normalizerFor<T>(name);
  }

  protected get entity(): EntityType {
    return STORE_ENTITY[this.name];
  }

  /** Rows are stored as the JSON this or an older build wrote; old shapes are normalized here. */
  protected parse(rows: Array<{ data: string }>): T[] {
    const normalize = this.normalize;
    return rows.map((r) => {
      const raw = JSON.parse(r.data) as T;
      return normalize ? normalize(raw) : raw;
    });
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
    return withTx(this.ctx, async (ctx) => {
      const updatedAt = options?.preserveUpdatedAt ? record.updatedAt : nowIso(ctx.clock);
      const stamped = this.schema.parse({ ...record, updatedAt });
      const store = new SqliteStore(this.name, this.schema, ctx);
      const prev = await store.get(stamped.id);
      await ctx.driver.execute(
        `INSERT INTO ${this.name}(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        [stamped.id, JSON.stringify(stamped)],
      );
      const meta = options?.opMeta ?? {};
      if (prev) {
        await store.log('update', stamped.id, {
          ...(shallowPatch(prev, stamped) as Record<string, unknown>),
          ...meta,
        });
      } else {
        await store.log('create', stamped.id, { ...stamped, ...meta });
      }
      return stamped;
    });
  }

  async softDelete(id: Id, options?: DeleteOptions): Promise<void> {
    await withTx(this.ctx, async (ctx) => {
      const store = new SqliteStore(this.name, this.schema, ctx);
      const prev = await store.get(id);
      if (!prev || prev.deletedAt !== null) return;
      const at = nowIso(this.ctx.clock);
      await ctx.driver.execute(`UPDATE ${this.name} SET data = ? WHERE id = ?`, [
        JSON.stringify({ ...prev, deletedAt: at, updatedAt: at }),
        id,
      ]);
      await store.log('delete', id, { deletedAt: at, ...options?.opMeta });
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
  const ctx: Ctx = {
    driver: transactionalDriver(options.driver),
    clock: options.clock ?? systemClock,
    inTransaction: false,
  };
  await ctx.driver.select('PRAGMA journal_mode = WAL');
  await ctx.driver.exec('PRAGMA synchronous = NORMAL');
  await ctx.driver.exec('PRAGMA foreign_keys = ON');
  if (!options.skipMigrations) await migrate(ctx.driver);
  return repositoryFor(ctx);
}

function repositoryFor(ctx: Ctx): Repository {
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
    reminders: new SqliteStore('reminders', ReminderSchema, ctx),
    appSettings: new SqliteStore('appSettings', AppSettingsSchema, ctx),
    links: new SqliteLinkStore('links', LinkSchema, ctx),
    opLog: new SqliteOpLog(ctx),

    async transaction<T>(fn: (tx: Repository) => Promise<T>): Promise<T> {
      return withTx(ctx, (tx) => fn(repositoryFor(tx)));
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
