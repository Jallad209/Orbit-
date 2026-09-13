import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { NoteSchema, TaskSchema, createRecord, fixedClock, seedWorld } from '@orbit/core';
import type { FixedClock } from '@orbit/core';
import { createSqliteRepository, integrityCheck } from '../../src/sqlite';
import type { SqlDriver } from '../../src/sqlite/driver';
import { loadSearchSnapshot, toSearchDocuments } from '../../src/search/documents';
import { createSearchService } from '../../src/search/factory';
import { FTS_SCHEMA, createFts5SearchService, fts5Available } from '../../src/search/fts5';
import { betterSqliteDriver } from '../betterSqliteDriver';
import { seedSearchWorld } from './fixture';
import { searchContract } from './contract';

const dir = mkdtempSync(join(tmpdir(), 'orbit-fts5-'));
const FIXTURES = fileURLToPath(new URL('../../../../tests/fixtures/', import.meta.url));
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));

searchContract('fts5', {
  open: async (clock) => {
    const driver = betterSqliteDriver();
    const repo = await createSqliteRepository({ driver, clock });
    return { repo, service: createFts5SearchService({ driver, repo }) };
  },
});

interface FtsRow {
  type: string;
  id: string;
  areaId: string | null;
  updatedAt: string;
  title: string;
  body: string;
}

async function ftsRows(driver: SqlDriver): Promise<FtsRow[]> {
  const rows = await driver.select<FtsRow>(
    'SELECT type, id, areaId, updatedAt, title, body FROM search_fts ORDER BY type, id',
  );
  return rows.map((r) => ({ ...r, areaId: r.areaId ?? null }));
}

async function documents(repo: Awaited<ReturnType<typeof createSqliteRepository>>) {
  return toSearchDocuments(await loadSearchSnapshot(repo))
    .map((d) => ({
      type: d.type,
      id: d.id,
      areaId: d.areaId,
      updatedAt: d.updatedAt,
      title: d.title,
      body: d.body,
    }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
}

async function openFile(file: string, clock: FixedClock) {
  const driver = betterSqliteDriver(file);
  const repo = await createSqliteRepository({ driver, clock });
  return { driver, repo };
}

describe('FTS5 backend', () => {
  it('is available in the bundled SQLite, probed without touching user data', async () => {
    const driver = betterSqliteDriver();
    expect(await fts5Available(driver)).toBe(true);
    const tables = await driver.select<{ name: string }>('SELECT name FROM sqlite_schema');
    expect(tables).toEqual([]);
  });

  it('indexes exactly the documents documents.ts defines (parity), and keeps them in step through triggers', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const driver = betterSqliteDriver();
    const repo = await createSqliteRepository({ driver, clock });
    const world = seedWorld({ seed: 3, sizes: { tasks: 120, notes: 30, people: 6 } });
    await repo.transaction(async (tx) => {
      for (const a of world.areas) await tx.areas.upsert(a, { preserveUpdatedAt: true });
      for (const p of world.projects) await tx.projects.upsert(p, { preserveUpdatedAt: true });
      for (const t of world.tasks) await tx.tasks.upsert(t, { preserveUpdatedAt: true });
      for (const n of world.notes) await tx.notes.upsert(n, { preserveUpdatedAt: true });
      for (const p of world.people) await tx.people.upsert(p, { preserveUpdatedAt: true });
    });
    const small = await seedSearchWorld(repo, clock);
    const service = createFts5SearchService({ driver, repo });
    await service.ready();
    expect(await ftsRows(driver)).toEqual(await documents(repo));

    // Every kind of change, with no refresh in between: the triggers do it.
    clock.advance(1000);
    await repo.projects.upsert({ ...small.thesis, title: 'Dissertation', outcome: '  ' });
    await repo.areas.upsert({ ...small.university, name: 'Campus' });
    await repo.notes.upsert({ ...small.readingList, body: 'Rewritten body about lasers.' });
    await repo.tasks.softDelete(small.groceries.id);
    await repo.people.upsert({ ...small.omar, contact: '' });
    await repo.tasks.upsert(
      createRecord(TaskSchema, clock, {
        title: 'Fresh',
        status: 'open',
        projectId: small.thesis.id,
      }),
    );
    await repo.areas.softDelete(small.home.id);
    await repo.projects.softDelete(world.projects[0]!.id);
    expect(await ftsRows(driver)).toEqual(await documents(repo));
    expect((await service.search('type:task campus')).map((h) => h.id)).toEqual([small.fees.id]);
    expect((await service.search('lasers')).map((h) => h.id)).toEqual([small.readingList.id]);
    expect((await service.search('dissertation')).map((h) => h.id)).toContain(small.fees.id);
    expect(await service.search('groceries')).toEqual([]);
    expect((await service.stats()).rebuilds).toBe(1);
    expect((await integrityCheck(driver)).ok).toBe(true);
  });

  it('backfills rows written before the service existed, then trusts the cache', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const file = join(dir, 'backfill.db');
    const first = await openFile(file, clock);
    const world = await seedSearchWorld(first.repo, clock);
    const service = createFts5SearchService(first);
    await service.ready();
    expect((await service.search('univ')).length).toBe(3);
    expect((await service.stats()).rebuilds).toBe(1);
    await first.repo.close();

    // Reopen: the marker is current and the counts agree, so nothing is rebuilt.
    const second = await openFile(file, clock);
    const again = createFts5SearchService(second);
    await again.ready();
    expect((await again.stats()).rebuilds).toBe(0);
    expect((await again.stats()).schema).toBe(FTS_SCHEMA);
    expect((await again.search('univ')).map((h) => h.id)).toContain(world.readingList.id);
    await second.repo.close();
  });

  it('rows written while no service was running are still indexed by the triggers', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const file = join(dir, 'older-orbit.db');
    const first = await openFile(file, clock);
    await seedSearchWorld(first.repo, clock);
    await createFts5SearchService(first).ready();
    await first.repo.close();

    const older = await openFile(file, clock);
    const late = createRecord(NoteSchema, clock, { title: 'Written by an older build' });
    await older.repo.notes.upsert(late);
    await older.repo.close();

    const now = await openFile(file, clock);
    const service = createFts5SearchService(now);
    await service.ready();
    expect((await service.stats()).rebuilds).toBe(0);
    expect((await service.search('older build')).map((h) => h.id)).toEqual([late.id]);
    await now.repo.close();
  });

  it('rebuilds when the schema marker is old or the cache has drifted', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const { driver, repo } = await openFile(join(dir, 'drift.db'), clock);
    await seedSearchWorld(repo, clock);
    await createFts5SearchService({ driver, repo }).ready();

    await driver.execute("UPDATE search_meta SET value = '0' WHERE key = 'schema'");
    const stale = createFts5SearchService({ driver, repo });
    await stale.ready();
    expect((await stale.stats()).rebuilds).toBe(1);
    expect((await stale.stats()).schema).toBe(FTS_SCHEMA);

    await driver.execute("DELETE FROM search_fts WHERE type = 'task'");
    const drifted = createFts5SearchService({ driver, repo });
    await drifted.ready();
    expect((await drifted.stats()).rebuilds).toBe(1);
    expect((await drifted.search('type:task univ')).length).toBe(1);

    // A partial cache (a trigger gone) means writes went unindexed: rebuild.
    await driver.exec('DROP TRIGGER search_tasks_au');
    const partial = createFts5SearchService({ driver, repo });
    partial.invalidate();
    await partial.refresh();
    expect((await partial.stats()).rebuilds).toBe(1);
    expect(await ftsRows(driver)).toEqual(await documents(repo));
    expect(await partial.refresh()).toBeUndefined(); // nothing pending: no second pass
    expect((await partial.stats()).rebuilds).toBe(1);
    await repo.close();
  });

  it('a week 9 data file without search tables opens, indexes, and stays a valid Orbit file', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const file = join(dir, 'week9.db');
    copyFileSync(join(FIXTURES, 'db', 'v2.db'), file);
    const { driver, repo } = await openFile(file, clock);
    const before = await driver.select<{ name: string }>(
      "SELECT name FROM sqlite_schema WHERE name LIKE 'search%'",
    );
    expect(before).toEqual([]);
    const service = createFts5SearchService({ driver, repo });
    await service.ready();
    expect((await service.stats()).documents).toBe(
      (await repo.tasks.count()) +
        (await repo.notes.count()) +
        (await repo.projects.count()) +
        (await repo.people.count()),
    );
    expect((await service.search('note')).length).toBeGreaterThan(0);
    expect((await integrityCheck(driver)).ok).toBe(true);
    await repo.close();
  });

  it('the factory falls back to MiniSearch when FTS5 is missing', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const raw = betterSqliteDriver();
    const noFts: SqlDriver = {
      ...raw,
      exec: async (sql) => {
        if (/fts5/iu.test(sql)) throw new Error('no such module: fts5');
        return raw.exec(sql);
      },
    };
    const repo = await createSqliteRepository({ driver: noFts, clock });
    await seedSearchWorld(repo, clock);
    const fallback = await createSearchService({ repo, driver: noFts });
    expect(fallback.backend).toBe('minisearch');
    await fallback.ready();
    expect((await fallback.search('univ')).length).toBe(3);

    const real = await createSearchService({ repo, driver: raw });
    expect(real.backend).toBe('fts5');
    const forced = await createSearchService({ repo, driver: raw, preferMiniSearch: true });
    expect(forced.backend).toBe('minisearch');
    await repo.close();
  });
});
