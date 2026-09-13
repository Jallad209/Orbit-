import 'fake-indexeddb/auto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { fixedClock, seedCount, seedWorld } from '@orbit/core';
import type { SeedWorld } from '@orbit/core';
import {
  STORE_ORDER,
  exportJson,
  importJson,
  parseExport,
  serializeExport,
} from '../../src/export';
import { createIndexedDbRepository } from '../../src/indexeddb';
import { createMemoryRepository } from '../../src/memory';
import type { EntityStore, Repository } from '../../src/repository';
import type { BaseRecord } from '@orbit/core';

/**
 * Data-safety job (DEVOPS-TASKS week 5): seed → export → import into a
 * fresh database → export again → the two exports are byte-identical.
 * `ROUNDTRIP_SIZE` is the number of tasks; the workflow runs 50,000.
 */
const SIZE = Number(process.env.ROUNDTRIP_SIZE ?? 5000);
const clock = fixedClock('2026-09-12T09:00:00.000Z');

function world(tasks: number): SeedWorld {
  return seedWorld({
    seed: 11,
    sizes: {
      tasks,
      notes: Math.ceil(tasks / 5),
      events: Math.ceil(tasks / 50),
      people: 25,
      days: 60,
    },
  });
}

async function load(repo: Repository, w: SeedWorld): Promise<void> {
  await repo.transaction(async (tx) => {
    for (const name of STORE_ORDER) {
      const store = tx[name] as unknown as EntityStore<BaseRecord>;
      for (const rec of w[name]) await store.upsert(rec, { preserveUpdatedAt: true });
    }
  });
}

async function roundTrip(open: () => Promise<Repository>, w: SeedWorld) {
  const a = await open();
  await load(a, w);
  const first = await exportJson(a, clock);
  const text = serializeExport(first);
  await a.close();

  const b = await open();
  const report = await importJson(b, parseExport(text), { mode: 'replace' });
  const second = await exportJson(b, clock);
  await b.close();
  return { first, second, report, bytes: text.length };
}

describe(`export/import round trip (${SIZE} tasks)`, () => {
  it('memory: every record survives with timestamps intact', async () => {
    const w = world(SIZE);
    const total = seedCount(w);
    const { first, second, report, bytes } = await roundTrip(
      async () => createMemoryRepository({ clock }),
      w,
    );
    expect(report.totals.create).toBe(total);
    expect(report.totals.update + report.totals.skip + report.totals.remove).toBe(0);
    for (const name of STORE_ORDER) expect(second.data[name]).toHaveLength(w[name].length);
    expect(serializeExport(second)).toBe(serializeExport(first));
    console.log(`round trip ok: ${total} records, ${(bytes / 1024 / 1024).toFixed(1)} MB export`);
  }, 120_000);

  it('indexeddb: the same round trip through Dexie', async () => {
    const w = world(Math.max(200, Math.floor(SIZE / 10)));
    let n = 0;
    const factories = [new IDBFactory(), new IDBFactory()];
    const { first, second, report } = await roundTrip(
      async () =>
        createIndexedDbRepository({
          name: 'orbit-roundtrip',
          clock,
          indexedDB: factories[n++]!,
          IDBKeyRange,
        }),
      w,
    );
    expect(report.totals.create).toBe(seedCount(w));
    expect(second.data).toEqual(first.data);
  }, 120_000);

  it('a diff of the two exports is empty store by store, including soft-deleted rows', async () => {
    const w = world(300);
    const a = createMemoryRepository({ clock });
    await load(a, w);
    await a.tasks.softDelete(w.tasks[0]!.id);
    await a.notes.softDelete(w.notes[0]!.id);
    const first = await exportJson(a, clock);
    const b = createMemoryRepository({ clock });
    await importJson(b, first, { mode: 'replace' });
    const second = await exportJson(b, clock);
    const diff = STORE_ORDER.filter(
      (name) => JSON.stringify(first.data[name]) !== JSON.stringify(second.data[name]),
    );
    expect(diff).toEqual([]);
    expect(second.data.tasks.filter((t) => t.deletedAt !== null)).toHaveLength(1);
  });
});
