import { z } from 'zod';
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
  InstantSchema,
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
  normalizeAppSettings,
  normalizeInsightState,
  nowIso,
  systemClock,
} from '@orbit/core';
import type { BaseRecord, Clock } from '@orbit/core';
import type { EntityStore, Repository, StoreName } from '../repository';

export const EXPORT_FORMAT = 'orbit-export';
/**
 * Bump when the export envelope or any entity shape changes incompatibly.
 * 4 (week 11): insight settings on the settings document; snooze mode,
 * fingerprint, and summary on insight states. Older readers refuse a v4
 * file rather than silently dropping those fields; this reader defaults
 * them for v1–3 files.
 */
export const EXPORT_SCHEMA_VERSION = 4;

/** Parents before children so a future FK-checking importer can stream in order. */
export const STORE_ORDER: StoreName[] = [
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
  'reminders',
  'appSettings',
  'links',
];

const STORE_SCHEMAS: Record<StoreName, z.ZodTypeAny> = {
  areas: AreaSchema,
  goals: GoalSchema,
  projects: ProjectSchema,
  milestones: MilestoneSchema,
  tasks: TaskSchema,
  events: EventSchema,
  routines: RoutineSchema,
  routineInstances: RoutineInstanceSchema,
  notes: NoteSchema,
  people: PersonSchema,
  commitments: CommitmentSchema,
  bills: BillSchema,
  blocks: BlockSchema,
  dayCommitments: DayCommitmentSchema,
  sessions: SessionSchema,
  rules: RuleSchema,
  insightStates: InsightStateSchema,
  captures: CaptureSchema,
  reminders: ReminderSchema,
  appSettings: AppSettingsSchema,
  links: LinkSchema,
};

const DataSchema = z.object(
  Object.fromEntries(STORE_ORDER.map((s) => [s, z.array(STORE_SCHEMAS[s]).default([])])) as Record<
    StoreName,
    z.ZodDefault<z.ZodArray<z.ZodTypeAny>>
  >,
);

export const ExportEnvelopeSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  schemaVersion: z.number().int().min(1),
  exportedAt: InstantSchema,
  /** Latest op-log seq at export time; informational for future sync. */
  opLogSeq: z.number().int().min(0),
  data: DataSchema,
});

export interface ExportEnvelope {
  format: typeof EXPORT_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  opLogSeq: number;
  data: Record<StoreName, BaseRecord[]>;
}

export type ExportErrorCode = 'invalid-json' | 'invalid-format' | 'newer-schema';

export class ExportError extends Error {
  constructor(
    public readonly code: ExportErrorCode,
    message: string,
    public readonly issues?: z.ZodIssue[],
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

function storeOf(repo: Repository, name: StoreName): EntityStore<BaseRecord> {
  return repo[name] as unknown as EntityStore<BaseRecord>;
}

/** Snapshot every store, including soft-deleted rows, for full-fidelity backup. */
export async function exportJson(
  repo: Repository,
  clock: Clock = systemClock,
): Promise<ExportEnvelope> {
  const data = {} as Record<StoreName, BaseRecord[]>;
  for (const name of STORE_ORDER) {
    const rows = await storeOf(repo, name).list({ includeDeleted: true });
    data[name] = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return {
    format: EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: nowIso(clock),
    opLogSeq: await repo.opLog.latestSeq(),
    data,
  };
}

export function serializeExport(envelope: ExportEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}

/**
 * Validate an export. Accepts a JSON string or an already-parsed object.
 * Throws `ExportError` with a code the UI can map to a message.
 */
export function parseExport(input: string | unknown): ExportEnvelope {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new ExportError('invalid-json', 'The file is not valid JSON.');
    }
  }
  const head = z.object({ format: z.string(), schemaVersion: z.number().int() }).safeParse(raw);
  if (!head.success || head.data.format !== EXPORT_FORMAT) {
    throw new ExportError('invalid-format', 'The file is not an Orbit export.');
  }
  if (head.data.schemaVersion > EXPORT_SCHEMA_VERSION) {
    throw new ExportError(
      'newer-schema',
      `This export was made by a newer Orbit (schema ${head.data.schemaVersion}, this app reads ${EXPORT_SCHEMA_VERSION}). Update Orbit first.`,
    );
  }
  const result = ExportEnvelopeSchema.safeParse(normalizeOldStores(raw));
  if (!result.success) {
    throw new ExportError(
      'invalid-format',
      'The export contains invalid records.',
      result.error.issues,
    );
  }
  return result.data as ExportEnvelope;
}

/**
 * Files from before v4 carry settings without `insights` and insight states
 * without a snooze mode. The compatibility policy runs on the raw rows before
 * validation so a legacy timed snooze is recognised as one; a row it cannot
 * repair is left for validation to report.
 */
function normalizeOldStores(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const data = (raw as { data?: Record<string, unknown> }).data;
  if (typeof data !== 'object' || data === null) return raw;
  const fix = (rows: unknown, normalize: (row: unknown) => BaseRecord) =>
    Array.isArray(rows)
      ? rows.map((row) => {
          try {
            return normalize(row);
          } catch {
            return row;
          }
        })
      : rows;
  return {
    ...raw,
    data: {
      ...data,
      ...(data.appSettings !== undefined
        ? { appSettings: fix(data.appSettings, (r) => normalizeAppSettings(r).record) }
        : {}),
      ...(data.insightStates !== undefined
        ? { insightStates: fix(data.insightStates, (r) => normalizeInsightState(r).record) }
        : {}),
    },
  };
}

export type ImportMode = 'merge' | 'replace';

export interface ImportStoreReport {
  incoming: number;
  create: number;
  update: number;
  skip: number;
  /** Replace mode only: local rows absent from the file that were soft-deleted. */
  remove: number;
}

export interface ImportReport {
  mode: ImportMode;
  dryRun: boolean;
  schemaVersion: number;
  stores: Record<StoreName, ImportStoreReport>;
  totals: ImportStoreReport;
}

export interface ImportOptions {
  /** `merge` keeps whichever copy is newer; `replace` makes the file the source of truth. */
  mode?: ImportMode;
  /** Compute the report without writing anything. */
  dryRun?: boolean;
}

interface Plan {
  creates: BaseRecord[];
  updates: BaseRecord[];
  removes: string[];
  report: ImportStoreReport;
}

async function planStore(
  repo: Repository,
  name: StoreName,
  incoming: BaseRecord[],
  mode: ImportMode,
): Promise<Plan> {
  const store = storeOf(repo, name);
  const existing = new Map((await store.list({ includeDeleted: true })).map((r) => [r.id, r]));
  const plan: Plan = {
    creates: [],
    updates: [],
    removes: [],
    report: { incoming: incoming.length, create: 0, update: 0, skip: 0, remove: 0 },
  };
  const seen = new Set<string>();
  for (const rec of incoming) {
    seen.add(rec.id);
    const local = existing.get(rec.id);
    if (!local) {
      plan.creates.push(rec);
      plan.report.create += 1;
    } else if (mode === 'replace' || rec.updatedAt > local.updatedAt) {
      plan.updates.push(rec);
      plan.report.update += 1;
    } else {
      plan.report.skip += 1;
    }
  }
  if (mode === 'replace') {
    for (const [id, local] of existing) {
      if (!seen.has(id) && local.deletedAt === null) {
        plan.removes.push(id);
        plan.report.remove += 1;
      }
    }
  }
  return plan;
}

/**
 * Import an export envelope. Timestamps are preserved from the file so a
 * round trip is lossless. All writes happen in one transaction.
 */
export async function importJson(
  repo: Repository,
  envelope: ExportEnvelope,
  options: ImportOptions = {},
): Promise<ImportReport> {
  const mode = options.mode ?? 'merge';
  const dryRun = options.dryRun ?? false;
  const stores = {} as Record<StoreName, ImportStoreReport>;
  const totals: ImportStoreReport = { incoming: 0, create: 0, update: 0, skip: 0, remove: 0 };
  const plans = new Map<StoreName, Plan>();

  for (const name of STORE_ORDER) {
    const plan = await planStore(repo, name, envelope.data[name] ?? [], mode);
    plans.set(name, plan);
    stores[name] = plan.report;
    for (const k of Object.keys(totals) as (keyof ImportStoreReport)[]) totals[k] += plan.report[k];
  }

  if (!dryRun) {
    await repo.transaction(async (tx) => {
      for (const name of STORE_ORDER) {
        const plan = plans.get(name)!;
        const store = storeOf(tx, name);
        for (const rec of plan.creates) await store.upsert(rec, { preserveUpdatedAt: true });
        for (const rec of plan.updates) await store.upsert(rec, { preserveUpdatedAt: true });
        for (const id of plan.removes) await store.softDelete(id);
      }
    });
  }

  return { mode, dryRun, schemaVersion: envelope.schemaVersion, stores, totals };
}
