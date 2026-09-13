import { describe, expect, it } from 'vitest';
import { NoteSchema, TaskSchema, createRecord, fixedClock, seedWorld } from '@orbit/core';
import { createMemoryRepository } from '../../src/memory';
import type { Repository } from '../../src/repository';
import { createMiniSearchService } from '../../src/search/minisearch';
import { seedSearchWorld } from './fixture';
import { searchContract } from './contract';

searchContract('minisearch', {
  open: async (clock) => {
    const repo = createMemoryRepository({ clock });
    return { repo, service: createMiniSearchService({ repo }) };
  },
});

async function seeded(rebuildThreshold?: number) {
  const clock = fixedClock('2026-09-12T09:00:00.000Z');
  const repo = createMemoryRepository({ clock });
  const world = await seedSearchWorld(repo, clock);
  const service = createMiniSearchService({ repo, rebuildThreshold });
  await service.ready();
  return { clock, repo, world, service };
}

describe('MiniSearch backend', () => {
  it('applies op-log entries incrementally and advances the cursor only after they are in', async () => {
    const { repo, service, clock } = await seeded();
    const built = service.stats();
    expect(built.cursor).toBe(await repo.opLog.latestSeq());
    const documents = built.documents;

    const memo = createRecord(NoteSchema, clock, { title: 'Budget memo' });
    await repo.notes.upsert(memo);
    await repo.notes.upsert({ ...memo, title: 'Budget memo v2' });
    await service.refresh();
    const after = service.stats();
    expect(after.cursor).toBe(await repo.opLog.latestSeq());
    expect(after.documents).toBe(documents + 1);
    expect((await service.search('memo'))[0]?.title).toBe('Budget memo v2');
  });

  it('rebuilds instead of replaying when too many entries are pending', async () => {
    const { repo, service, clock } = await seeded(3);
    for (let i = 0; i < 5; i += 1) {
      await repo.tasks.upsert(
        createRecord(TaskSchema, clock, { title: `Bulk ${i}`, status: 'open' }),
      );
    }
    await service.refresh();
    expect((await service.search('bulk')).length).toBe(5);
    expect(service.stats().cursor).toBe(await repo.opLog.latestSeq());
  });

  it('keeps the old index answering when an incremental pass fails, then rebuilds', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const inner = createMemoryRepository({ clock });
    let failNext = false;
    const repo: Repository = {
      ...inner,
      tasks: {
        ...inner.tasks,
        get: async (id) => {
          if (failNext) {
            failNext = false;
            throw new Error('disk hiccup');
          }
          return inner.tasks.get(id);
        },
      },
    };
    const world = await seedSearchWorld(repo, clock);
    const service = createMiniSearchService({ repo });
    await service.ready();

    await repo.tasks.upsert({ ...world.groceries, title: 'Buy oat milk' });
    failNext = true;
    await service.refresh();
    expect(service.stats().lastError).toBe('disk hiccup');
    expect(service.stats().cursor).toBeNull();
    // Old answers still come back…
    expect((await service.search('groceries')).map((h) => h.id)).toEqual([world.groceries.id]);
    // …and the next refresh rebuilds from live records.
    await service.refresh();
    expect(service.stats().lastError).toBeNull();
    expect((await service.search('oat')).map((h) => h.id)).toEqual([world.groceries.id]);
    expect(await service.search('groceries')).toEqual([]);
  });

  it('serializes and restores, ignoring a stale or unreadable snapshot', async () => {
    const { repo, service, world, clock } = await seeded();
    const snapshot = service.serialize();
    expect(snapshot).not.toContain('"cursor":null');

    const restored = createMiniSearchService({ repo, serialized: snapshot });
    expect(restored.stats().cursor).toBe(service.stats().cursor);
    expect((await restored.search('univ')).map((h) => h.id).sort()).toEqual(
      (await service.search('univ')).map((h) => h.id).sort(),
    );
    // Changes after the snapshot are caught up from the cursor, not rebuilt.
    clock.advance(1000);
    await repo.tasks.upsert({ ...world.groceries, title: 'Restored later' });
    await restored.refresh();
    expect((await restored.search('restored')).map((h) => h.id)).toEqual([world.groceries.id]);

    const stale = JSON.stringify({ ...JSON.parse(snapshot), version: 0 });
    const fresh = createMiniSearchService({ repo, serialized: stale });
    expect(fresh.stats().cursor).toBeNull();
    const broken = createMiniSearchService({ repo, serialized: '{not json' });
    expect(broken.stats().cursor).toBeNull();
    await broken.ready();
    expect((await broken.search('restored')).map((h) => h.id)).toEqual([world.groceries.id]);
  });

  it('handles a 50,000-task world: builds once and answers a query quickly', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const repo = createMemoryRepository({ clock });
    const world = seedWorld({ seed: 11, sizes: { tasks: 50_000, notes: 5_000, days: 30 } });
    await repo.transaction(async (tx) => {
      for (const a of world.areas) await tx.areas.upsert(a, { preserveUpdatedAt: true });
      for (const p of world.projects) await tx.projects.upsert(p, { preserveUpdatedAt: true });
      for (const t of world.tasks) await tx.tasks.upsert(t, { preserveUpdatedAt: true });
      for (const n of world.notes) await tx.notes.upsert(n, { preserveUpdatedAt: true });
      for (const p of world.people) await tx.people.upsert(p, { preserveUpdatedAt: true });
    });
    const service = createMiniSearchService({ repo });
    await service.ready();
    expect(service.stats().documents).toBe(
      world.tasks.length + world.notes.length + world.projects.length + world.people.length,
    );
    const started = performance.now();
    const hits = await service.search('review the', undefined, 20);
    const elapsed = performance.now() - started;
    expect(hits.length).toBe(20);
    expect(elapsed).toBeLessThan(500); // the strict 30 ms budget is the benchmark's job
    expect((await service.search('type:note note 12')).length).toBeGreaterThan(0);
  }, 60_000);
});
