import Dexie, { type Table } from 'dexie';
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

export const INDEXEDDB_SCHEMA_VERSION = 2;
export const DEFAULT_DB_NAME = 'orbit';

/**
 * Dexie store definitions. First entry is the primary key; the rest are
 * indexes. `deletedAt` is not indexed because IndexedDB cannot index null.
 *
 * Versions are additive: each `version(n)` lists only what changed, and Dexie
 * upgrades older databases in place. Never edit a shipped version.
 */
const STORES_V1: Record<Exclude<StoreName, 'captures'> | 'opLog', string> = {
  areas: 'id',
  goals: 'id, areaId, status',
  projects: 'id, areaId, goalId, status',
  milestones: 'id, projectId',
  tasks: 'id, projectId, areaId, status, dueAt',
  events: 'id, startAt',
  routines: 'id, areaId',
  routineInstances: 'id, routineId, date',
  notes: 'id, projectId, areaId',
  people: 'id',
  commitments: 'id, personId, status',
  bills: 'id, dueAt, paid',
  blocks: 'id, date, taskId',
  dayCommitments: 'id, date',
  sessions: 'id, taskId, startAt',
  rules: 'id, type',
  insightStates: 'id, insightKey',
  links: 'id, [fromType+fromId], [toType+toId]',
  opLog: '++seq, entity, entityId',
};

/** v2 (week 3): inbox captures. */
const STORES_V2: Partial<Record<StoreName, string>> = {
  captures: 'id, status, type',
};

/** Every shipped schema version, oldest first. The migration matrix replays these. */
export const SCHEMA_VERSIONS: ReadonlyArray<{ version: number; stores: Record<string, string> }> = [
  { version: 1, stores: STORES_V1 },
  { version: 2, stores: STORES_V2 as Record<string, string> },
];

type OpLogInsert = Omit<OpLogEntry, 'seq'>;

class OrbitDb extends Dexie {
  opLog!: Table<OpLogEntry, number, OpLogInsert>;

  constructor(name: string, deps?: { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange }) {
    super(name, deps ? { indexedDB: deps.indexedDB, IDBKeyRange: deps.IDBKeyRange } : undefined);
    this.version(1).stores(STORES_V1);
    this.version(2).stores(STORES_V2);
  }
}

interface Ctx {
  db: OrbitDb;
  clock: Clock;
}

class IdbStore<T extends BaseRecord> implements EntityStore<T> {
  constructor(
    protected readonly name: StoreName,
    protected readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    protected readonly ctx: Ctx,
  ) {}

  protected get table(): Table<T, Id> {
    return this.ctx.db.table(this.name) as Table<T, Id>;
  }

  protected get entity(): EntityType {
    return STORE_ENTITY[this.name];
  }

  protected async log(op: Op, entityId: Id, patch: Record<string, unknown>): Promise<void> {
    await this.ctx.db.opLog.add({
      entity: this.entity,
      entityId,
      op,
      patch,
      at: nowIso(this.ctx.clock),
    });
  }

  async get(id: Id): Promise<T | undefined> {
    return this.table.get(id);
  }

  async getMany(ids: readonly Id[]): Promise<T[]> {
    const rows = await this.table.bulkGet([...ids]);
    return rows.filter((r): r is T => r !== undefined);
  }

  async list(options?: ListOptions): Promise<T[]> {
    if (options?.includeDeleted) return this.table.toArray();
    return this.table.filter((r) => r.deletedAt === null).toArray();
  }

  async query(predicate: (record: T) => boolean, options?: ListOptions): Promise<T[]> {
    if (options?.includeDeleted) return this.table.filter(predicate).toArray();
    return this.table.filter((r) => r.deletedAt === null && predicate(r)).toArray();
  }

  async count(options?: ListOptions): Promise<number> {
    if (options?.includeDeleted) return this.table.count();
    return this.table.filter((r) => r.deletedAt === null).count();
  }

  async upsert(record: T, options?: UpsertOptions): Promise<T> {
    const { db, clock } = this.ctx;
    const updatedAt = options?.preserveUpdatedAt ? record.updatedAt : nowIso(clock);
    // Validate before opening the transaction so a bad record never touches the DB.
    const stamped = this.schema.parse({ ...record, updatedAt });
    return db.transaction('rw', [this.table, db.opLog], async () => {
      const prev = await this.table.get(stamped.id);
      await this.table.put(stamped);
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
    const { db, clock } = this.ctx;
    await db.transaction('rw', [this.table, db.opLog], async () => {
      const prev = await this.table.get(id);
      if (!prev || prev.deletedAt !== null) return;
      const at = nowIso(clock);
      await this.table.put({ ...prev, deletedAt: at, updatedAt: at });
      await this.log('delete', id, { deletedAt: at });
    });
  }
}

class IdbLinkStore extends IdbStore<Link> implements LinkStore {
  async forEntity(type: EntityType, id: Id): Promise<Link[]> {
    const table = this.table;
    const [from, to] = await Promise.all([
      table.where('[fromType+fromId]').equals([type, id]).toArray(),
      table.where('[toType+toId]').equals([type, id]).toArray(),
    ]);
    const seen = new Set<Id>();
    const out: Link[] = [];
    for (const l of [...from, ...to]) {
      if (l.deletedAt === null && !seen.has(l.id)) {
        seen.add(l.id);
        out.push(l);
      }
    }
    return out;
  }
}

class IdbOpLog implements OpLogReader {
  constructor(private readonly ctx: Ctx) {}

  async since(afterSeq: number, limit?: number): Promise<OpLogEntry[]> {
    let q = this.ctx.db.opLog.where('seq').above(afterSeq);
    if (limit !== undefined) q = q.limit(limit);
    return q.toArray();
  }

  async latestSeq(): Promise<number> {
    const last = await this.ctx.db.opLog.orderBy('seq').last();
    return last?.seq ?? 0;
  }
}

export interface IndexedDbRepositoryOptions {
  /** Database name. Default "orbit". Tests use a unique name or a fresh factory. */
  name?: string;
  clock?: Clock;
  /** Inject an IndexedDB implementation (fake-indexeddb in Node). */
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
}

/**
 * Browser repository on IndexedDB via Dexie. Passes the same contract suite
 * as the in-memory adapter. Transactions use Dexie's, which roll back when
 * the callback rejects; nested calls become Dexie sub-transactions.
 *
 * The database is opened eagerly so schema upgrades and open failures
 * surface at startup, not on the first write.
 */
export async function createIndexedDbRepository(
  options: IndexedDbRepositoryOptions = {},
): Promise<Repository> {
  const deps =
    options.indexedDB && options.IDBKeyRange
      ? { indexedDB: options.indexedDB, IDBKeyRange: options.IDBKeyRange }
      : undefined;
  const db = new OrbitDb(options.name ?? DEFAULT_DB_NAME, deps);
  await db.open();
  const ctx: Ctx = { db, clock: options.clock ?? systemClock };

  const repo: Repository = {
    areas: new IdbStore('areas', AreaSchema, ctx),
    goals: new IdbStore('goals', GoalSchema, ctx),
    projects: new IdbStore('projects', ProjectSchema, ctx),
    milestones: new IdbStore('milestones', MilestoneSchema, ctx),
    tasks: new IdbStore('tasks', TaskSchema, ctx),
    events: new IdbStore('events', EventSchema, ctx),
    routines: new IdbStore('routines', RoutineSchema, ctx),
    routineInstances: new IdbStore('routineInstances', RoutineInstanceSchema, ctx),
    notes: new IdbStore('notes', NoteSchema, ctx),
    people: new IdbStore('people', PersonSchema, ctx),
    commitments: new IdbStore('commitments', CommitmentSchema, ctx),
    bills: new IdbStore('bills', BillSchema, ctx),
    blocks: new IdbStore('blocks', BlockSchema, ctx),
    dayCommitments: new IdbStore('dayCommitments', DayCommitmentSchema, ctx),
    sessions: new IdbStore('sessions', SessionSchema, ctx),
    rules: new IdbStore('rules', RuleSchema, ctx),
    insightStates: new IdbStore('insightStates', InsightStateSchema, ctx),
    captures: new IdbStore('captures', CaptureSchema, ctx),
    links: new IdbLinkStore('links', LinkSchema, ctx),
    opLog: new IdbOpLog(ctx),

    async transaction<T>(fn: (tx: Repository) => Promise<T>): Promise<T> {
      return db.transaction('rw', db.tables, () => fn(repo));
    },

    async close(): Promise<void> {
      db.close();
    },
  };

  return repo;
}

/** The schema version a stored database is at, without declaring any schema. */
export async function indexedDbVersion(
  name = DEFAULT_DB_NAME,
  deps?: { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange },
): Promise<number> {
  const db = new Dexie(
    name,
    deps ? { indexedDB: deps.indexedDB, IDBKeyRange: deps.IDBKeyRange } : undefined,
  );
  await db.open();
  const version = db.verno;
  db.close();
  return version;
}

/** Permanently delete a database. Used by tests and by "reset all data". */
export async function deleteIndexedDb(
  name = DEFAULT_DB_NAME,
  deps?: { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange },
): Promise<void> {
  // Go through an instance so an injected IDBFactory (tests) is honoured.
  const db = new Dexie(
    name,
    deps ? { indexedDB: deps.indexedDB, IDBKeyRange: deps.IDBKeyRange } : undefined,
  );
  await db.delete();
}
