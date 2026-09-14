import 'fake-indexeddb/auto';
import { readFileSync, readdirSync } from 'node:fs';
import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { CaptureSchema, createRecord, fixedClock, newWeeklyReview } from '@orbit/core';
import type { BaseRecord, Bill } from '@orbit/core';
import { EXPORT_SCHEMA_VERSION, STORE_ORDER, importJson, parseExport } from '../../src/export';
import {
  INDEXEDDB_SCHEMA_VERSION,
  SCHEMA_VERSIONS,
  createIndexedDbRepository,
  indexedDbVersion,
} from '../../src/indexeddb';
import { createMemoryRepository } from '../../src/memory';
import type { EntityStore, StoreName } from '../../src/repository';

/**
 * Migration matrix (DEVOPS-TASKS week 5). For every stored fixture version:
 * build a database at exactly that version, fill it, open it with today's
 * adapter (which upgrades in place), and assert nothing was lost.
 * Fixtures are produced by `pnpm run make:fixture` on every schema bump.
 */
const FIXTURES = new URL('../../../../tests/fixtures/', import.meta.url);
const clock = fixedClock('2026-09-12T09:00:00.000Z');

interface IdbFixture {
  schemaVersion: number;
  stores: Record<string, BaseRecord[]>;
}

function fixtureFiles(kind: 'idb' | 'export'): string[] {
  return readdirSync(new URL(`${kind}/`, FIXTURES))
    .filter((f) => /^v\d+\.json$/.test(f))
    .sort((a, b) => Number(a.slice(1, -5)) - Number(b.slice(1, -5)));
}

describe('IndexedDB schema upgrades', () => {
  const files = fixtureFiles('idb');

  it('has a fixture for the current schema version', () => {
    expect(files).toContain(`v${INDEXEDDB_SCHEMA_VERSION}.json`);
    expect(SCHEMA_VERSIONS.at(-1)?.version).toBe(INDEXEDDB_SCHEMA_VERSION);
  });

  for (const file of files) {
    it(`upgrades a ${file.slice(0, -5)} database to v${INDEXEDDB_SCHEMA_VERSION} keeping every row`, async () => {
      const fixture = JSON.parse(
        readFileSync(new URL(`idb/${file}`, FIXTURES), 'utf8'),
      ) as IdbFixture;
      const factory = new IDBFactory();
      const deps = { indexedDB: factory, IDBKeyRange };

      // Build the database exactly as that version of Orbit would have.
      const old = new Dexie('orbit-migrate', deps);
      for (const v of SCHEMA_VERSIONS) {
        if (v.version <= fixture.schemaVersion) old.version(v.version).stores(v.stores);
      }
      await old.open();
      expect(old.verno).toBe(fixture.schemaVersion);
      for (const [name, rows] of Object.entries(fixture.stores)) {
        if (rows.length) await old.table(name).bulkAdd(rows);
      }
      old.close();

      // Open with today's adapter: the upgrade runs here.
      const repo = await createIndexedDbRepository({ name: 'orbit-migrate', clock, ...deps });
      for (const name of STORE_ORDER) {
        const expected = fixture.stores[name]?.length ?? 0;
        const store = repo[name] as unknown as EntityStore<BaseRecord>;
        expect(await store.count({ includeDeleted: true }), name).toBe(expected);
      }
      // Stores added after this fixture's version are usable straight away.
      await repo.captures.upsert(
        createRecord(CaptureSchema, clock, { text: 'after upgrade', type: 'task' }),
      );
      expect(await repo.captures.count()).toBe((fixture.stores.captures?.length ?? 0) + 1);
      // Week 12: the review stores exist after the upgrade and old recurring bills read as roots.
      const review = newWeeklyReview(clock, '2026-09-12');
      await repo.weeklyReviews.upsert(review);
      expect(await repo.weeklyReviews.get(review.id)).toEqual(review);
      for (const bill of await repo.bills.list({ includeDeleted: true })) {
        if ((bill as Bill).recurrence) expect((bill as Bill).seriesId).not.toBeNull();
      }
      await repo.close();

      expect(await indexedDbVersion('orbit-migrate', deps)).toBe(INDEXEDDB_SCHEMA_VERSION);
    });
  }
});

describe('export file versions', () => {
  const files = fixtureFiles('export');

  it('has a fixture for the current export schema version', () => {
    expect(files).toContain(`v${EXPORT_SCHEMA_VERSION}.json`);
  });

  for (const file of files) {
    it(`imports an ${file.slice(0, -5)} export into a fresh database`, async () => {
      const text = readFileSync(new URL(`export/${file}`, FIXTURES), 'utf8');
      const envelope = parseExport(text);
      const repo = createMemoryRepository({ clock });
      const report = await importJson(repo, envelope, { mode: 'replace' });
      const expected = STORE_ORDER.reduce(
        (n, name: StoreName) => n + (envelope.data[name]?.length ?? 0),
        0,
      );
      expect(report.totals.create).toBe(expected);
      expect(expected).toBeGreaterThan(0);
    });
  }
});
