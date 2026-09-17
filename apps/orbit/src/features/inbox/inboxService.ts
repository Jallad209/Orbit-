import { defaultTaskEstimate } from '@/features/settings/settingsService';
import {
  CaptureSchema,
  createRecord,
  materializeCapture,
  parseCapture,
  reclassify,
  systemClock,
} from '@orbit/core';
import type {
  BaseRecord,
  Capture,
  CaptureContext,
  CaptureFields,
  CaptureResult,
  CaptureType,
  Clock,
  Id,
  LocalDate,
} from '@orbit/core';
import type { EntityStore, Repository } from '@orbit/storage';
import { bumpData } from '@/data/useQuery';

export interface CaptureNames {
  people: string[];
  projects: string[];
}

/** Names the parser uses to link bare mentions. Cheap; called per keystroke via memo. */
export async function loadCaptureNames(repo: Repository): Promise<CaptureNames> {
  const [people, projects] = await Promise.all([repo.people.list(), repo.projects.list()]);
  return {
    people: people.map((p) => p.name),
    projects: projects.filter((p) => p.status === 'active').map((p) => p.title),
  };
}

export function contextFor(names: CaptureNames | undefined, clock: Clock): CaptureContext {
  return { now: clock.now(), people: names?.people ?? [], projects: names?.projects ?? [] };
}

/** Fields stored on a Capture are loosely typed; normalise them back. */
export function captureFields(capture: Capture): CaptureFields {
  const f = capture.fields as Partial<CaptureFields>;
  return {
    ...f,
    title: f.title ?? capture.text,
    people: f.people ?? [],
    projects: f.projects ?? [],
  };
}

export async function saveCapture(
  repo: Repository,
  result: CaptureResult,
  clock: Clock = systemClock,
): Promise<Capture> {
  const capture = createRecord(CaptureSchema, clock, {
    text: result.text,
    type: result.type,
    fields: result.fields as unknown as Record<string, unknown>,
    confidence: result.confidence,
    status: 'inbox',
  });
  await repo.captures.upsert(capture);
  bumpData();
  return capture;
}

/** Inbox items, newest first. */
export async function listInbox(repo: Repository): Promise<Capture[]> {
  const rows = await repo.captures.query((c) => c.status === 'inbox');
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export async function setCaptureType(
  repo: Repository,
  capture: Capture,
  type: CaptureType,
  names: CaptureNames | undefined,
  clock: Clock = systemClock,
): Promise<Capture> {
  const ctx = contextFor(names, clock);
  const result = reclassify(parseCapture(capture.text, ctx), type, ctx);
  const next = await repo.captures.upsert({
    ...capture,
    type,
    fields: result.fields as unknown as Record<string, unknown>,
    confidence: 1,
  });
  bumpData();
  return next;
}

/** Set the relevant date for the capture's type (due date, or event date). */
export async function setCaptureDate(
  repo: Repository,
  capture: Capture,
  date: LocalDate | null,
): Promise<Capture> {
  const fields = captureFields(capture);
  const patch: Partial<CaptureFields> =
    capture.type === 'event' ? { date: date ?? undefined } : { dueDate: date ?? undefined };
  const next = await repo.captures.upsert({
    ...capture,
    fields: { ...fields, ...patch } as unknown as Record<string, unknown>,
  });
  bumpData();
  return next;
}

export async function archiveCapture(repo: Repository, capture: Capture): Promise<void> {
  await repo.captures.upsert({ ...capture, status: 'archived' });
  bumpData();
}

/** Put an archived capture back in the inbox. Used by the triage Undo action. */
export async function restoreArchivedCapture(repo: Repository, captureId: Id): Promise<void> {
  const capture = await repo.captures.get(captureId);
  if (!capture || capture.status !== 'archived') return;
  await repo.captures.upsert({ ...capture, status: 'inbox' });
  bumpData();
}

export interface ConvertOptions {
  projectId?: Id | null;
  areaId?: Id | null;
  /** Override the stored type at conversion time. */
  type?: CaptureType;
}

export interface ConvertedRecordRef {
  type: string;
  id: Id;
  updatedAt: string;
}

export interface ConversionResult {
  type: string;
  id: Id;
  /** Records actually created by this call. Empty when a repeated accept replays the result. */
  created: ConvertedRecordRef[];
  replayed: boolean;
}

function storeForType(repo: Repository, type: string): EntityStore<BaseRecord> {
  const stores: Record<string, EntityStore<BaseRecord>> = {
    task: repo.tasks as unknown as EntityStore<BaseRecord>,
    event: repo.events as unknown as EntityStore<BaseRecord>,
    note: repo.notes as unknown as EntityStore<BaseRecord>,
    goal: repo.goals as unknown as EntityStore<BaseRecord>,
    routine: repo.routines as unknown as EntityStore<BaseRecord>,
    bill: repo.bills as unknown as EntityStore<BaseRecord>,
    person: repo.people as unknown as EntityStore<BaseRecord>,
    commitment: repo.commitments as unknown as EntityStore<BaseRecord>,
  };
  const store = stores[type];
  if (!store) throw new Error(`Cannot resolve store for ${type}`);
  return store;
}

/**
 * Turn a capture into real records in one transaction and mark it processed.
 * Throws `MaterializeError` (code `needs-area` / `needs-person`) when the
 * type needs input the capture does not have; the UI maps codes to prompts.
 */
export async function convertCapture(
  repo: Repository,
  capture: Capture,
  options: ConvertOptions = {},
  clock: Clock = systemClock,
): Promise<ConversionResult> {
  const type = options.type ?? capture.type;
  const fields = captureFields(capture);
  const people = await repo.people.list();
  const projectId = options.projectId ?? null;
  const areaId =
    options.areaId ?? (projectId ? ((await repo.projects.get(projectId))?.areaId ?? null) : null);
  const { records, primary } = materializeCapture(type, fields, clock, {
    defaultEstimateMin: await defaultTaskEstimate(repo, clock),
    projectId,
    areaId,
    people,
  });

  const result = await repo.transaction(async (tx): Promise<ConversionResult> => {
    const current = await tx.captures.get(capture.id);
    if (current?.status === 'processed' && current.processedType && current.processedId) {
      return {
        type: current.processedType,
        id: current.processedId,
        created: [],
        replayed: true,
      };
    }
    if (!current || current.status !== 'inbox') {
      throw new Error('This capture is no longer available to accept.');
    }

    const created: ConvertedRecordRef[] = [];
    for (const r of records) {
      const store = tx[r.store] as unknown as EntityStore<BaseRecord>;
      const saved = await store.upsert(r.record);
      created.push({
        type: r.store === 'people' ? 'person' : r.store.slice(0, -1),
        id: saved.id,
        updatedAt: saved.updatedAt,
      });
    }
    await tx.captures.upsert({
      ...current,
      type,
      status: 'processed',
      processedType: primary.type,
      processedId: primary.id,
    });
    return { ...primary, created, replayed: false };
  });
  if (!result.replayed) bumpData();
  return result;
}

/** Reverse one Inbox conversion when none of its new records have changed since creation. */
export async function undoCaptureConversion(
  repo: Repository,
  captureId: Id,
  conversion: ConversionResult,
): Promise<void> {
  if (conversion.replayed) return;
  await repo.transaction(async (tx) => {
    const capture = await tx.captures.get(captureId);
    if (!capture || capture.status !== 'processed' || capture.processedId !== conversion.id) {
      throw new Error('This capture has changed and cannot be restored.');
    }
    for (const ref of [...conversion.created].reverse()) {
      const store = storeForType(tx, ref.type);
      const current = await store.get(ref.id);
      if (!current || current.updatedAt !== ref.updatedAt) {
        throw new Error('The added item has changed and cannot be safely undone.');
      }
      await store.softDelete(ref.id);
    }
    await tx.captures.upsert({
      ...capture,
      status: 'inbox',
      processedType: null,
      processedId: null,
    });
  });
  bumpData();
}
