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

export interface ConvertOptions {
  projectId?: Id | null;
  areaId?: Id | null;
  /** Override the stored type at conversion time. */
  type?: CaptureType;
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
): Promise<{ type: string; id: Id }> {
  const type = options.type ?? capture.type;
  const fields = captureFields(capture);
  const people = await repo.people.list();
  const projectId = options.projectId ?? null;
  const areaId =
    options.areaId ?? (projectId ? ((await repo.projects.get(projectId))?.areaId ?? null) : null);
  const { records, primary } = materializeCapture(type, fields, clock, {
    projectId,
    areaId,
    people,
  });

  await repo.transaction(async (tx) => {
    for (const r of records) {
      const store = tx[r.store] as unknown as EntityStore<BaseRecord>;
      await store.upsert(r.record);
    }
    await tx.captures.upsert({
      ...capture,
      type,
      status: 'processed',
      processedType: primary.type,
      processedId: primary.id,
    });
  });
  bumpData();
  return primary;
}
