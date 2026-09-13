import type { z } from 'zod';
import type { Clock } from '../clock';
import type {
  Area,
  BaseRecord,
  Bill,
  Block,
  Commitment,
  DayCommitment,
  EntityType,
  Event,
  Goal,
  Id,
  Note,
  Person,
  Project,
  Routine,
  Rule,
  Session,
  Task,
} from '../schema';

/**
 * The command registry: typed, validated actions the palette (and any other
 * surface) can run uniformly. Commands live in core so their argument
 * schemas, availability, and mutations are testable without a UI; the app
 * supplies the context — a repository, a clock, navigation, notices.
 */

/** Write options the commands rely on; `@orbit/storage` implements them. */
export interface CommandWriteOptions {
  preserveUpdatedAt?: boolean;
  /** Extra keys for the op-log patch (e.g. `{ undoOf }`). */
  opMeta?: Record<string, unknown>;
}

/** The slice of an entity store the commands use. Structural: the storage stores satisfy it. */
export interface CommandStore<T extends BaseRecord> {
  get(id: Id): Promise<T | undefined>;
  list(options?: { includeDeleted?: boolean }): Promise<T[]>;
  query(predicate: (record: T) => boolean, options?: { includeDeleted?: boolean }): Promise<T[]>;
  upsert(record: T, options?: CommandWriteOptions): Promise<T>;
  softDelete(id: Id, options?: { opMeta?: Record<string, unknown> }): Promise<void>;
}

/** The repository as the commands see it. `@orbit/storage`'s `Repository` is one. */
export interface CommandRepository {
  readonly areas: CommandStore<Area>;
  readonly goals: CommandStore<Goal>;
  readonly projects: CommandStore<Project>;
  readonly tasks: CommandStore<Task>;
  readonly events: CommandStore<Event>;
  readonly routines: CommandStore<Routine>;
  readonly notes: CommandStore<Note>;
  readonly people: CommandStore<Person>;
  readonly commitments: CommandStore<Commitment>;
  readonly bills: CommandStore<Bill>;
  readonly blocks: CommandStore<Block>;
  readonly dayCommitments: CommandStore<DayCommitment>;
  readonly sessions: CommandStore<Session>;
  readonly rules: CommandStore<Rule>;
  readonly opLog: { latestSeq(): Promise<number> };
  transaction<T>(fn: (tx: CommandRepository) => Promise<T>): Promise<T>;
}

/** Entities the commands write, and the store each lives in. */
export const COMMAND_STORES = {
  task: 'tasks',
  event: 'events',
  note: 'notes',
  person: 'people',
  commitment: 'commitments',
  bill: 'bills',
  goal: 'goals',
  routine: 'routines',
  project: 'projects',
  block: 'blocks',
  dayCommitment: 'dayCommitments',
} as const satisfies Partial<Record<EntityType, keyof CommandRepository>>;

export type UndoableEntity = keyof typeof COMMAND_STORES;

export function storeFor(
  repo: CommandRepository,
  entity: UndoableEntity,
): CommandStore<BaseRecord> {
  return repo[COMMAND_STORES[entity]] as unknown as CommandStore<BaseRecord>;
}

/** One record a command changed: what it was, what it became. */
export interface UndoChange {
  entity: UndoableEntity;
  entityId: Id;
  /** Null when the command created the record. */
  before: BaseRecord | null;
  after: BaseRecord;
}

export interface CommandNotice {
  title: string;
  description?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}

/** What the current runtime can show, so commands route honestly. */
export interface CommandCapabilities {
  /** The insights screen exists (week 11). */
  insights: boolean;
  /** The weekly review flow exists (week 12). */
  weeklyReview: boolean;
}

export interface CommandSettings {
  /** Estimate for a task captured without one. */
  defaultEstimateMin: number;
}

export interface CommandContext {
  repo: CommandRepository;
  clock: Clock;
  navigate(path: string): void;
  notify(notice: CommandNotice): void;
  capabilities: CommandCapabilities;
  settings: CommandSettings;
  /** Known names for the capture parser: linking `@omar` and `#thesis`. */
  names?: { people: readonly string[]; projects: readonly string[] };
  /** Whether anything can be undone right now; the undo command checks it. */
  canUndo?: () => boolean;
}

export type CommandGroup = 'Create' | 'Plan' | 'Review' | 'Navigate' | 'Orbit';

export interface CommandChoice {
  value: string;
  label: string;
  hint?: string;
}

/** How the UI asks for a command's argument before running it. */
export type CommandPrompt =
  | {
      kind: 'text';
      /** The argument field the text fills. */
      field: string;
      label: string;
      placeholder?: string;
    }
  | {
      kind: 'choice';
      field: string;
      label: string;
      choices: (ctx: CommandContext) => Promise<CommandChoice[]>;
    };

export interface CommandOutcome {
  /** Success notice; nothing shown when absent. */
  message?: string;
  detail?: string;
  /** Reversible changes to record on the undo stack, in the order they were made. */
  changes?: UndoChange[];
}

export interface CommandDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string;
  title: string;
  /** Extra words the palette matches on. */
  keywords: readonly string[];
  group: CommandGroup;
  /** Hotkey spec for the shortcuts reference, when the app binds one. */
  shortcut?: string;
  /** Argument schema; validated before `run`. Absent means no arguments. */
  args?: S;
  prompt?: CommandPrompt;
  /** A one-line preview shown before a mutating command runs (e.g. "3 tasks move to tomorrow"). */
  preview?: (ctx: CommandContext, args: z.output<S>) => Promise<string | null>;
  /** Hide the command when it cannot do anything useful right now. */
  available?: (ctx: CommandContext) => boolean;
  run(ctx: CommandContext, args: z.output<S>): Promise<CommandOutcome>;
}

export interface CommandValidationFailure {
  ok: false;
  kind: 'invalid';
  /** Field → message, for inline errors. */
  errors: Record<string, string>;
  message: string;
}

export type CommandRunResult =
  | { ok: true; outcome: CommandOutcome; undoId: string | null }
  | CommandValidationFailure
  | { ok: false; kind: 'failed'; message: string };
