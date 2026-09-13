import { describe, expect, it } from 'vitest';
import {
  AreaSchema,
  BillSchema,
  GoalSchema,
  LinkSchema,
  MilestoneSchema,
  NoteSchema,
  PersonSchema,
  ProjectSchema,
  TaskSchema,
  createRecord,
  fixedClock,
} from '@orbit/core';
import type { Area, FixedClock } from '@orbit/core';
import {
  EXPORT_SCHEMA_VERSION,
  ExportError,
  exportJson,
  exportMarkdown,
  importJson,
  parseExport,
  serializeExport,
} from '../src/export';
import { createMemoryRepository } from '../src/memory';
import type { Repository } from '../src/repository';

async function seed(clock: FixedClock): Promise<Repository> {
  const repo = createMemoryRepository({ clock });
  const area = createRecord(AreaSchema, clock, { name: 'Study' });
  const goal = createRecord(GoalSchema, clock, {
    title: 'Graduate',
    areaId: area.id,
    importance: 5,
  });
  const project = createRecord(ProjectSchema, clock, {
    title: 'Thesis',
    areaId: area.id,
    goalId: goal.id,
    outcome: 'A submitted thesis.',
    deadline: '2026-12-01',
  });
  const m1 = createRecord(MilestoneSchema, clock, {
    projectId: project.id,
    title: 'Outline',
    done: true,
  });
  const m2 = createRecord(MilestoneSchema, clock, {
    projectId: project.id,
    title: 'Draft',
    order: 1,
  });
  const t1 = createRecord(TaskSchema, clock, {
    title: 'Write intro',
    projectId: project.id,
    status: 'open',
  });
  const t2 = createRecord(TaskSchema, clock, { title: 'Old idea', status: 'open' });
  const note = createRecord(NoteSchema, clock, {
    title: 'Sources',
    body: 'See chapter 2.',
    projectId: project.id,
  });
  const person = createRecord(PersonSchema, clock, { name: 'Omar' });
  const bill = createRecord(BillSchema, clock, {
    title: 'Electricity',
    amount: 120,
    dueAt: '2026-10-01',
  });
  const link = createRecord(LinkSchema, clock, {
    fromType: 'task',
    fromId: t1.id,
    toType: 'note',
    toId: note.id,
  });

  await repo.transaction(async (tx) => {
    await tx.areas.upsert(area);
    await tx.goals.upsert(goal);
    await tx.projects.upsert({ ...project, nextActionTaskId: t1.id });
    await tx.milestones.upsert(m1);
    await tx.milestones.upsert(m2);
    await tx.tasks.upsert(t1);
    await tx.tasks.upsert(t2);
    await tx.notes.upsert(note);
    await tx.people.upsert(person);
    await tx.bills.upsert(bill);
    await tx.links.upsert(link);
  });
  clock.advance(60_000);
  await repo.tasks.softDelete(t2.id); // keep a deleted row in the export
  return repo;
}

describe('JSON export / import', () => {
  it('round-trips every record, including soft-deleted rows, with timestamps intact', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const source = await seed(clock);
    const envelope = await exportJson(source, clock);
    expect(envelope.format).toBe('orbit-export');
    expect(envelope.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(envelope.data.tasks).toHaveLength(2);
    expect(envelope.data.links).toHaveLength(1);

    const text = serializeExport(envelope);
    const parsed = parseExport(text);

    const target = createMemoryRepository({ clock: fixedClock('2027-01-01T00:00:00.000Z') });
    const report = await importJson(target, parsed);
    expect(report.totals.create).toBe(11);
    expect(report.totals.update).toBe(0);

    const again = await exportJson(target, clock);
    expect(again.data).toEqual(envelope.data); // timestamps preserved, deleted rows preserved

    const deleted = (await target.tasks.list({ includeDeleted: true })).find((t) => t.deletedAt);
    expect(deleted?.deletedAt).toBe('2026-09-12T09:01:00.000Z');
    expect(await target.tasks.count()).toBe(1);
  });

  it('dry run reports counts without writing', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const envelope = await exportJson(await seed(clock), clock);
    const target = createMemoryRepository({ clock });
    const report = await importJson(target, envelope, { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.totals.create).toBe(11);
    expect(await target.areas.count()).toBe(0);
    expect(await target.opLog.latestSeq()).toBe(0);
  });

  it('merge keeps the newer copy and skips older incoming records', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const source = await seed(clock);
    const envelope = await exportJson(source, clock);
    const area = envelope.data.areas[0] as Area;

    // Target already has the same area, edited later than the export.
    const targetClock = fixedClock('2026-09-13T09:00:00.000Z');
    const target = createMemoryRepository({ clock: targetClock });
    await target.areas.upsert({ ...area, name: 'Study (local edit)' });

    const report = await importJson(target, envelope, { mode: 'merge' });
    expect(report.stores.areas).toEqual({ incoming: 1, create: 0, update: 0, skip: 1, remove: 0 });
    expect((await target.areas.get(area.id))?.name).toBe('Study (local edit)');

    // An older local copy is overwritten.
    const staleClock = fixedClock('2026-01-01T00:00:00.000Z');
    const stale = createMemoryRepository({ clock: staleClock });
    await stale.areas.upsert({ ...area, name: 'Stale' });
    const r2 = await importJson(stale, envelope, { mode: 'merge' });
    expect(r2.stores.areas.update).toBe(1);
    expect((await stale.areas.get(area.id))?.name).toBe('Study');
  });

  it('replace soft-deletes local rows absent from the file', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const envelope = await exportJson(await seed(clock), clock);
    const target = createMemoryRepository({ clock });
    const extra = createRecord(AreaSchema, clock, { name: 'Only here' });
    await target.areas.upsert(extra);

    const report = await importJson(target, envelope, { mode: 'replace' });
    expect(report.stores.areas.remove).toBe(1);
    expect((await target.areas.get(extra.id))?.deletedAt).not.toBeNull();
    expect(await target.areas.count()).toBe(1);
  });

  it('rejects non-JSON, non-Orbit files, and newer schemas with typed errors', async () => {
    expect(() => parseExport('{not json')).toThrow(ExportError);
    try {
      parseExport('{not json');
    } catch (e) {
      expect((e as ExportError).code).toBe('invalid-json');
    }
    try {
      parseExport({ format: 'something-else', schemaVersion: 1 });
    } catch (e) {
      expect((e as ExportError).code).toBe('invalid-format');
    }
    try {
      parseExport({ format: 'orbit-export', schemaVersion: EXPORT_SCHEMA_VERSION + 1, data: {} });
    } catch (e) {
      expect((e as ExportError).code).toBe('newer-schema');
    }
    try {
      parseExport({
        format: 'orbit-export',
        schemaVersion: 1,
        exportedAt: 'x',
        opLogSeq: 0,
        data: { areas: [{ id: 'bad' }] },
      });
    } catch (e) {
      expect((e as ExportError).code).toBe('invalid-format');
      expect((e as ExportError).issues?.length).toBeGreaterThan(0);
    }
  });

  it('import is atomic: a bad record rolls back the whole import', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const envelope = await exportJson(await seed(clock), clock);
    // Corrupt one record after validation (simulates an adapter-level failure).
    const corrupted = structuredClone(envelope);
    (corrupted.data.tasks[0] as unknown as { title: string }).title = '';
    const target = createMemoryRepository({ clock });
    await expect(importJson(target, corrupted)).rejects.toThrow();
    expect(await target.areas.count()).toBe(0);
    expect(await target.opLog.latestSeq()).toBe(0);
  });

  it('reads a v3 file with week-9 settings and insight states under the v4 contract', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const envelope = await exportJson(await seed(clock), clock);
    const base = {
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      deletedAt: null,
    };
    const v3 = {
      ...envelope,
      schemaVersion: 3,
      data: {
        ...envelope.data,
        appSettings: [
          {
            ...base,
            id: '00000000-0000-7000-8000-000000000001',
            workingWindow: { startMin: 480, endMin: 960 },
            restBoundaries: [],
            bufferMin: 5,
            defaultEstimateMin: 45,
            eveningStartMin: 1000,
          },
        ],
        insightStates: [
          {
            ...base,
            id: '019372a0-0000-7000-8000-00000000a001',
            insightKey: 'neglected-goal:demo',
            snoozedUntil: '2099-01-01T00:00:00.000Z',
            dismissedAt: null,
          },
          {
            ...base,
            id: '019372a0-0000-7000-8000-00000000a002',
            insightKey: 'x',
            snoozedUntil: null,
            dismissedAt: '2026-09-01T00:00:00.000Z',
          },
        ],
      },
    };
    const parsed = parseExport(JSON.stringify(v3));
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.data.appSettings[0]).toMatchObject({
      defaultEstimateMin: 45,
      insights: { staleProjectDays: 10, estimateRatioThreshold: 1.3 },
    });
    expect(parsed.data.insightStates).toMatchObject([
      { snoozeMode: 'time', suppressedFingerprint: null, lastSummary: null },
      { snoozeMode: null, dismissedAt: '2026-09-01T00:00:00.000Z', lastSummary: null },
    ]);
    // Imported, then exported again: the file is now v4 and carries the same effective state.
    const target = createMemoryRepository({ clock });
    await importJson(target, parsed, { mode: 'replace' });
    const again = await exportJson(target, clock);
    expect(again.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(again.data.insightStates).toEqual(parsed.data.insightStates);
    expect(again.data.appSettings).toEqual(parsed.data.appSettings);
    // A malformed legacy row is still refused as invalid rather than silently dropped.
    const broken = {
      ...v3,
      data: { ...v3.data, insightStates: [{ ...base, id: 'nope', insightKey: 'k' }] },
    };
    expect(() => parseExport(JSON.stringify(broken))).toThrow(ExportError);
  });
});

describe('Markdown export', () => {
  it('links each note to its actual file when titles are duplicated or slug-collide', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const repo = await seed(clock);
    const project = (await repo.projects.list())[0]!;
    for (const title of ['Sources', 'Sources!']) {
      await repo.notes.upsert(
        createRecord(NoteSchema, clock, {
          title,
          body: `Another note: ${title}`,
          projectId: project.id,
        }),
      );
    }
    const files = await exportMarkdown(repo);
    const content = files.find((f) => f.path === 'projects/thesis.md')!.content;
    const links = [...content.matchAll(/\]\(\.\.\/(notes\/[^)]+)\)/g)].map((m) => m[1]);
    expect(links).toHaveLength(3);
    expect(new Set(links).size).toBe(3);
    for (const path of links)
      expect(files.find((f) => f.path === path)?.content).toContain('# Sources');
  });

  it('writes an index, a file per project with milestones and tasks, notes, people, and bills', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const files = await exportMarkdown(await seed(clock));
    const paths = files.map((f) => f.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'README.md',
        'projects/thesis.md',
        'notes/sources.md',
        'people.md',
        'bills.md',
      ]),
    );

    const project = files.find((f) => f.path === 'projects/thesis.md')!.content;
    expect(project).toContain('# Thesis');
    expect(project).toContain('Deadline: 2026-12-01');
    expect(project).toContain('## Milestones (1/2)');
    expect(project).toContain('- [x] Outline');
    expect(project).toContain('- [ ] Draft');
    expect(project).toContain('Write intro');
    expect(project).toContain('← next action');
    expect(project).not.toContain('Old idea'); // soft-deleted rows are omitted

    const index = files.find((f) => f.path === 'README.md')!.content;
    expect(index).toContain('## Study');
    expect(index).toContain('[Thesis](projects/thesis.md)');

    const bills = files.find((f) => f.path === 'bills.md')!.content;
    expect(bills).toContain('| Electricity | 120 | 2026-10-01 | no |');
  });

  it('makes file names unique for duplicate titles', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const repo = createMemoryRepository({ clock });
    const area = createRecord(AreaSchema, clock, { name: 'A' });
    await repo.areas.upsert(area);
    await repo.projects.upsert(
      createRecord(ProjectSchema, clock, { title: 'Plan', areaId: area.id }),
    );
    await repo.projects.upsert(
      createRecord(ProjectSchema, clock, { title: 'Plan!', areaId: area.id }),
    );
    const paths = (await exportMarkdown(repo)).map((f) => f.path);
    expect(paths).toContain('projects/plan.md');
    expect(paths).toContain('projects/plan-2.md');
  });
});
