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

export interface MemoryRepositoryOptions {
  clock?: Clock;
}

/** Shared mutable state so the transaction can snapshot and restore it. */
interface State {
  tables: Map<StoreName, Map<Id, BaseRecord>>;
  opLog: OpLogEntry[];
}

function cloneState(state: State): State {
  const tables = new Map<StoreName, Map<Id, BaseRecord>>();
  for (const [name, table] of state.tables) tables.set(name, new Map(table));
  return { tables, opLog: [...state.opLog] };
}

class MemoryStore<T extends BaseRecord> implements EntityStore<T> {
  constructor(
    protected readonly name: StoreName,
    protected readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    protected readonly ctx: { state: State; clock: Clock },
  ) {}

  protected get table(): Map<Id, T> {
    let table = this.ctx.state.tables.get(this.name);
    if (!table) {
      table = new Map();
      this.ctx.state.tables.set(this.name, table);
    }
    return table as Map<Id, T>;
  }

  protected get entity(): EntityType {
    return STORE_ENTITY[this.name];
  }

  protected log(op: Op, entityId: Id, patch: Record<string, unknown>): void {
    const { state, clock } = this.ctx;
    state.opLog.push({
      seq: state.opLog.length + 1,
      entity: this.entity,
      entityId,
      op,
      patch,
      at: nowIso(clock),
    });
  }

  async get(id: Id): Promise<T | undefined> {
    return this.table.get(id);
  }

  async getMany(ids: readonly Id[]): Promise<T[]> {
    const out: T[] = [];
    for (const id of ids) {
      const r = this.table.get(id);
      if (r) out.push(r);
    }
    return out;
  }

  async list(options?: ListOptions): Promise<T[]> {
    const rows = [...this.table.values()];
    return options?.includeDeleted ? rows : rows.filter((r) => r.deletedAt === null);
  }

  async query(predicate: (record: T) => boolean, options?: ListOptions): Promise<T[]> {
    return (await this.list(options)).filter(predicate);
  }

  async count(options?: ListOptions): Promise<number> {
    return (await this.list(options)).length;
  }

  async upsert(record: T, options?: UpsertOptions): Promise<T> {
    const prev = this.table.get(record.id);
    const updatedAt = options?.preserveUpdatedAt ? record.updatedAt : nowIso(this.ctx.clock);
    const stamped = this.schema.parse({ ...record, updatedAt });
    this.table.set(stamped.id, stamped);
    if (prev) {
      this.log('update', stamped.id, shallowPatch(prev, stamped) as Record<string, unknown>);
    } else {
      this.log('create', stamped.id, { ...stamped });
    }
    return stamped;
  }

  async softDelete(id: Id): Promise<void> {
    const prev = this.table.get(id);
    if (!prev || prev.deletedAt !== null) return;
    const at = nowIso(this.ctx.clock);
    const next = { ...prev, deletedAt: at, updatedAt: at };
    this.table.set(id, next);
    this.log('delete', id, { deletedAt: at });
  }
}

class MemoryLinkStore extends MemoryStore<Link> implements LinkStore {
  async forEntity(type: EntityType, id: Id): Promise<Link[]> {
    return this.query(
      (l) => (l.fromType === type && l.fromId === id) || (l.toType === type && l.toId === id),
    );
  }
}

class MemoryOpLog implements OpLogReader {
  constructor(private readonly ctx: { state: State }) {}

  async since(afterSeq: number, limit = Number.POSITIVE_INFINITY): Promise<OpLogEntry[]> {
    const out: OpLogEntry[] = [];
    for (const entry of this.ctx.state.opLog) {
      if (entry.seq > afterSeq) {
        out.push(entry);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  async latestSeq(): Promise<number> {
    return this.ctx.state.opLog.length;
  }
}

/**
 * In-memory repository. Used by every engine test and as the reference
 * implementation for the repository contract suite.
 */
export function createMemoryRepository(options: MemoryRepositoryOptions = {}): Repository {
  const ctx = {
    state: { tables: new Map(), opLog: [] } as State,
    clock: options.clock ?? systemClock,
  };
  let depth = 0;

  const repo: Repository = {
    areas: new MemoryStore('areas', AreaSchema, ctx),
    goals: new MemoryStore('goals', GoalSchema, ctx),
    projects: new MemoryStore('projects', ProjectSchema, ctx),
    milestones: new MemoryStore('milestones', MilestoneSchema, ctx),
    tasks: new MemoryStore('tasks', TaskSchema, ctx),
    events: new MemoryStore('events', EventSchema, ctx),
    routines: new MemoryStore('routines', RoutineSchema, ctx),
    routineInstances: new MemoryStore('routineInstances', RoutineInstanceSchema, ctx),
    notes: new MemoryStore('notes', NoteSchema, ctx),
    people: new MemoryStore('people', PersonSchema, ctx),
    commitments: new MemoryStore('commitments', CommitmentSchema, ctx),
    bills: new MemoryStore('bills', BillSchema, ctx),
    blocks: new MemoryStore('blocks', BlockSchema, ctx),
    dayCommitments: new MemoryStore('dayCommitments', DayCommitmentSchema, ctx),
    sessions: new MemoryStore('sessions', SessionSchema, ctx),
    rules: new MemoryStore('rules', RuleSchema, ctx),
    insightStates: new MemoryStore('insightStates', InsightStateSchema, ctx),
    captures: new MemoryStore('captures', CaptureSchema, ctx),
    links: new MemoryLinkStore('links', LinkSchema, ctx),
    opLog: new MemoryOpLog(ctx),

    async transaction<T>(fn: (tx: Repository) => Promise<T>): Promise<T> {
      if (depth > 0) return fn(repo); // join the outer transaction
      const snapshot = cloneState(ctx.state);
      depth += 1;
      try {
        return await fn(repo);
      } catch (err) {
        ctx.state.tables = snapshot.tables;
        ctx.state.opLog = snapshot.opLog;
        throw err;
      } finally {
        depth -= 1;
      }
    },

    async close(): Promise<void> {
      /* nothing to release */
    },
  };

  return repo;
}
