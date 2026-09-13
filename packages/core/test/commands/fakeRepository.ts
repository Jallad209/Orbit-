import type { z } from 'zod';
import type { Clock } from '../../src/clock';
import { nowIso } from '../../src/clock';
import type {
  CommandRepository,
  CommandStore,
  CommandWriteOptions,
} from '../../src/commands/types';
import { shallowPatch } from '../../src/records';
import {
  AreaSchema,
  BillSchema,
  BlockSchema,
  CommitmentSchema,
  DayCommitmentSchema,
  EventSchema,
  GoalSchema,
  NoteSchema,
  PersonSchema,
  ProjectSchema,
  RoutineSchema,
  RuleSchema,
  SessionSchema,
  TaskSchema,
} from '../../src/schema';
import type { BaseRecord, Id, Op } from '../../src/schema';

/**
 * A tiny in-memory `CommandRepository` for the command tests: stamps
 * `updatedAt` from the clock, keeps an op log with patches (including
 * `opMeta`), and rolls a failed transaction back by snapshot. The real
 * adapters run the same command tests in `@orbit/storage`.
 */
export interface FakeOp {
  seq: number;
  entity: string;
  entityId: Id;
  op: Op;
  patch: Record<string, unknown>;
}

interface State {
  tables: Map<string, Map<Id, BaseRecord>>;
  ops: FakeOp[];
}

function store<T extends BaseRecord>(
  state: () => State,
  name: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  clock: Clock,
): CommandStore<T> {
  const table = () => {
    const s = state();
    let t = s.tables.get(name);
    if (!t) {
      t = new Map();
      s.tables.set(name, t);
    }
    return t as Map<Id, T>;
  };
  const log = (op: Op, entityId: Id, patch: Record<string, unknown>) => {
    const s = state();
    s.ops.push({ seq: s.ops.length + 1, entity: name, entityId, op, patch });
  };
  return {
    async get(id) {
      return table().get(id);
    },
    async list(options) {
      const rows = [...table().values()];
      return options?.includeDeleted ? rows : rows.filter((r) => r.deletedAt === null);
    },
    async query(predicate, options) {
      return (await this.list(options)).filter(predicate);
    },
    async upsert(record, options?: CommandWriteOptions) {
      const prev = table().get(record.id);
      const updatedAt = options?.preserveUpdatedAt ? record.updatedAt : nowIso(clock);
      const stamped = schema.parse({ ...record, updatedAt });
      table().set(stamped.id, stamped);
      const meta = options?.opMeta ?? {};
      if (prev) log('update', stamped.id, { ...shallowPatch(prev, stamped), ...meta });
      else log('create', stamped.id, { ...stamped, ...meta });
      return stamped;
    },
    async softDelete(id, options) {
      const prev = table().get(id);
      if (!prev || prev.deletedAt !== null) return;
      const at = nowIso(clock);
      table().set(id, { ...prev, deletedAt: at, updatedAt: at });
      log('delete', id, { deletedAt: at, ...options?.opMeta });
    },
  };
}

export interface FakeRepository extends CommandRepository {
  ops(): FakeOp[];
}

export function fakeRepository(clock: Clock): FakeRepository {
  let state: State = { tables: new Map(), ops: [] };
  const current = () => state;
  let depth = 0;

  const repo: FakeRepository = {
    areas: store(current, 'areas', AreaSchema, clock),
    goals: store(current, 'goals', GoalSchema, clock),
    projects: store(current, 'projects', ProjectSchema, clock),
    tasks: store(current, 'tasks', TaskSchema, clock),
    events: store(current, 'events', EventSchema, clock),
    routines: store(current, 'routines', RoutineSchema, clock),
    notes: store(current, 'notes', NoteSchema, clock),
    people: store(current, 'people', PersonSchema, clock),
    commitments: store(current, 'commitments', CommitmentSchema, clock),
    bills: store(current, 'bills', BillSchema, clock),
    blocks: store(current, 'blocks', BlockSchema, clock),
    dayCommitments: store(current, 'dayCommitments', DayCommitmentSchema, clock),
    sessions: store(current, 'sessions', SessionSchema, clock),
    rules: store(current, 'rules', RuleSchema, clock),
    opLog: { latestSeq: async () => state.ops.length },
    async transaction(fn) {
      if (depth > 0) return fn(repo);
      const snapshot: State = {
        tables: new Map([...state.tables].map(([k, v]) => [k, new Map(v)])),
        ops: [...state.ops],
      };
      depth += 1;
      try {
        return await fn(repo);
      } catch (e) {
        state = snapshot;
        throw e;
      } finally {
        depth -= 1;
      }
    },
    ops: () => state.ops,
  };
  return repo;
}
