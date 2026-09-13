import type {
  AppSettings,
  Area,
  BaseRecord,
  Bill,
  Capture,
  Block,
  Commitment,
  DayCommitment,
  EntityType,
  Event,
  Goal,
  Id,
  InsightState,
  Link,
  Milestone,
  Note,
  OpLogEntry,
  Person,
  Project,
  Reminder,
  Routine,
  RoutineInstance,
  Rule,
  Session,
  Task,
} from '@orbit/core';

export interface ListOptions {
  /** Include soft-deleted rows. Default false. */
  includeDeleted?: boolean;
}

export interface UpsertOptions {
  /**
   * Keep the record's own `updatedAt` instead of stamping the clock.
   * Used by import so a round trip is lossless. Default false.
   */
  preserveUpdatedAt?: boolean;
}

/**
 * One store per entity. Every mutation validates against the entity schema,
 * stamps `updatedAt` from the repository clock, and appends to the op log.
 */
export interface EntityStore<T extends BaseRecord> {
  /** Returns the row even when soft-deleted; `undefined` when unknown. */
  get(id: Id): Promise<T | undefined>;
  getMany(ids: readonly Id[]): Promise<T[]>;
  list(options?: ListOptions): Promise<T[]>;
  query(predicate: (record: T) => boolean, options?: ListOptions): Promise<T[]>;
  count(options?: ListOptions): Promise<number>;
  /** Insert or replace. Throws on schema violation. */
  upsert(record: T, options?: UpsertOptions): Promise<T>;
  /** Soft delete: sets `deletedAt`. No-op if already deleted. */
  softDelete(id: Id): Promise<void>;
}

export interface LinkStore extends EntityStore<Link> {
  /** All live links touching an entity, from either side. */
  forEntity(type: EntityType, id: Id): Promise<Link[]>;
}

export interface OpLogReader {
  /** Entries with `seq` strictly greater than `afterSeq`, ascending. */
  since(afterSeq: number, limit?: number): Promise<OpLogEntry[]>;
  latestSeq(): Promise<number>;
}

export interface Repository {
  readonly areas: EntityStore<Area>;
  readonly goals: EntityStore<Goal>;
  readonly projects: EntityStore<Project>;
  readonly milestones: EntityStore<Milestone>;
  readonly tasks: EntityStore<Task>;
  readonly events: EntityStore<Event>;
  readonly routines: EntityStore<Routine>;
  readonly routineInstances: EntityStore<RoutineInstance>;
  readonly notes: EntityStore<Note>;
  readonly people: EntityStore<Person>;
  readonly commitments: EntityStore<Commitment>;
  readonly bills: EntityStore<Bill>;
  readonly blocks: EntityStore<Block>;
  readonly dayCommitments: EntityStore<DayCommitment>;
  readonly sessions: EntityStore<Session>;
  readonly rules: EntityStore<Rule>;
  readonly insightStates: EntityStore<InsightState>;
  readonly captures: EntityStore<Capture>;
  readonly reminders: EntityStore<Reminder>;
  readonly appSettings: EntityStore<AppSettings>;
  readonly links: LinkStore;
  readonly opLog: OpLogReader;

  /**
   * Run `fn` atomically. If it throws, every mutation made inside is rolled
   * back, including op-log entries. Use the callback's `tx` for ALL operations
   * inside it. Only `tx.transaction` joins the outer transaction; independent
   * calls on the root repository wait for their own turn. Do not retain `tx`.
   */
  transaction<T>(fn: (tx: Repository) => Promise<T>): Promise<T>;

  close(): Promise<void>;
}

/** Store property name → entity type, used for op-log entries and links. */
export const STORE_ENTITY: Record<
  Exclude<keyof Repository, 'opLog' | 'transaction' | 'close'>,
  EntityType
> = {
  areas: 'area',
  goals: 'goal',
  projects: 'project',
  milestones: 'milestone',
  tasks: 'task',
  events: 'event',
  routines: 'routine',
  routineInstances: 'routineInstance',
  notes: 'note',
  people: 'person',
  commitments: 'commitment',
  bills: 'bill',
  blocks: 'block',
  dayCommitments: 'dayCommitment',
  sessions: 'session',
  rules: 'rule',
  insightStates: 'insightState',
  captures: 'capture',
  reminders: 'reminder',
  appSettings: 'appSettings',
  links: 'link',
};

export type StoreName = keyof typeof STORE_ENTITY;
