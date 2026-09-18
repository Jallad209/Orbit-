import {
  NoteSchema,
  WeeklyReviewActionSchema,
  createRecord,
  fixedClock,
  seedWorld,
} from '@orbit/core';
import type { Clock } from '@orbit/core';
import { createIndexedDbRepository, createSearchService, openRepository } from '@orbit/storage';
import type { Repository, SearchService } from '@orbit/storage';
import { betterSqliteDriver } from '@orbit/storage/test/betterSqliteDriver';
import { IDBKeyRange, indexedDB } from '@orbit/storage/test/fakeIndexedDb';

export interface AdapterBenchEntry {
  name: string;
  budgetMs: number;
  fn: () => unknown;
  heavy?: boolean;
}

interface Prepared {
  name: 'sqlite' | 'indexeddb';
  repo: Repository;
  search: SearchService;
  receiptId: string;
  noteId: string;
}

async function seed(
  repo: Repository,
  clock: Clock,
): Promise<{ receiptId: string; noteId: string }> {
  const world = seedWorld({
    seed: 31,
    sizes: { tasks: 50_000, notes: 10_000, days: 120, projects: 1200, goals: 250, people: 200 },
  });
  const receipt = createRecord(WeeklyReviewActionSchema, clock, {
    reviewId: '019372a0-0000-7000-8000-000000000001',
    step: 'patterns',
    kind: 'acknowledge',
    refs: [],
    fingerprint: 'bench',
    choice: {},
    result: {},
    at: clock.now().toISOString(),
    supersedes: null,
  });
  await repo.transaction(async (tx) => {
    for (const area of world.areas) await tx.areas.upsert(area, { preserveUpdatedAt: true });
    for (const goal of world.goals) await tx.goals.upsert(goal, { preserveUpdatedAt: true });
    for (const project of world.projects)
      await tx.projects.upsert(project, { preserveUpdatedAt: true });
    for (const milestone of world.milestones)
      await tx.milestones.upsert(milestone, { preserveUpdatedAt: true });
    for (const task of world.tasks) await tx.tasks.upsert(task, { preserveUpdatedAt: true });
    for (const note of world.notes) await tx.notes.upsert(note, { preserveUpdatedAt: true });
    for (const person of world.people) await tx.people.upsert(person, { preserveUpdatedAt: true });
    for (const session of world.sessions)
      await tx.sessions.upsert(session, { preserveUpdatedAt: true });
    for (const block of world.blocks) await tx.blocks.upsert(block, { preserveUpdatedAt: true });
    await tx.weeklyReviewActions.upsert(receipt, { preserveUpdatedAt: true });
  });
  return { receiptId: receipt.id, noteId: world.notes[0]!.id };
}

async function prepare(): Promise<Prepared[]> {
  const clock = fixedClock('2026-09-17T09:00:00.000Z');
  const sqliteDriver = betterSqliteDriver();
  const sqlite = await openRepository({ kind: 'sqlite', driver: sqliteDriver });
  const idb = await createIndexedDbRepository({
    name: `orbit-bench-${Date.now()}`,
    clock,
    indexedDB,
    IDBKeyRange,
  });
  const out: Prepared[] = [];
  for (const [name, repo, driver] of [
    ['sqlite', sqlite, sqliteDriver] as const,
    ['indexeddb', idb, undefined] as const,
  ]) {
    const ids = await seed(repo, clock);
    const search = await createSearchService({ repo, driver });
    await search.ready();
    out.push({ name, repo, search, ...ids });
  }
  return out;
}

async function weeklySnapshot(repo: Repository) {
  return Promise.all([
    repo.areas.list(),
    repo.goals.list(),
    repo.projects.list(),
    repo.milestones.list(),
    repo.tasks.list(),
    repo.blocks.list(),
    repo.sessions.list(),
    repo.people.list(),
    repo.commitments.list(),
    repo.bills.list(),
    repo.dailyReflections.list(),
  ]);
}

export async function prepareAdapterBenchEntries(): Promise<AdapterBenchEntry[]> {
  const prepared = await prepare();
  return prepared.flatMap(({ name, repo, search, receiptId, noteId }) => [
    {
      name: `adapter:${name}: list open tasks, 50k`,
      budgetMs: 1_000,
      heavy: true,
      fn: () => repo.tasks.query((task) => task.status === 'open'),
    },
    {
      name: `adapter:${name}: search query, 50k tasks + 10k notes`,
      budgetMs: 50,
      fn: () => search.search('review the', undefined, 20),
    },
    {
      name: `adapter:${name}: weekly snapshot load, 50k`,
      budgetMs: 1_500,
      heavy: true,
      fn: () => weeklySnapshot(repo),
    },
    {
      name: `adapter:${name}: action receipt lookup`,
      budgetMs: 20,
      fn: () => repo.weeklyReviewActions.get(receiptId),
    },
    {
      name: `adapter:${name}: note save`,
      budgetMs: 100,
      fn: async () => {
        const note = (await repo.notes.get(noteId))!;
        await repo.notes.upsert(
          NoteSchema.parse({
            ...note,
            body: note.body.endsWith(' ') ? note.body.trimEnd() : `${note.body} `,
          }),
        );
      },
    },
    {
      name: `adapter:${name}: note preview read`,
      budgetMs: 20,
      fn: () => repo.notes.get(noteId),
    },
  ]);
}
