import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AreaSchema, TaskSchema, createRecord, fixedClock } from '@orbit/core';
import { EXPORT_SCHEMA_VERSION, exportJson, importJson, parseExport } from '../src/export';
import { openRepository } from '../src/factory';
import {
  MIGRATIONS,
  SQLITE_SCHEMA_VERSION,
  chooseRestore,
  createSqliteRepository,
  currentVersion,
  integrityCheck,
  migrate,
} from '../src/sqlite';
import { betterSqliteDriver } from './betterSqliteDriver';
import { repositoryContract } from './contract';

const dir = mkdtempSync(join(tmpdir(), 'orbit-sqlite-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

repositoryContract('sqlite', {
  open: async (clock) => createSqliteRepository({ driver: betterSqliteDriver(), clock }),
});

describe('SQLite adapter', () => {
  it('opens through the factory, in WAL mode, and persists across reopen', async () => {
    const file = join(dir, 'orbit.db');
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const a = await openRepository({ kind: 'sqlite', driver: betterSqliteDriver(file), clock });
    const area = createRecord(AreaSchema, clock, { name: 'Health' });
    const task = createRecord(TaskSchema, clock, { title: 'Run' });
    await a.areas.upsert(area);
    await a.tasks.upsert(task);
    await a.tasks.softDelete(task.id);
    expect(await a.opLog.latestSeq()).toBe(3);
    expect(existsSync(`${file}-wal`)).toBe(true);
    await a.close();

    const driver = betterSqliteDriver(file);
    expect(
      (await driver.select<{ journal_mode: string }>('PRAGMA journal_mode'))[0]?.journal_mode,
    ).toBe('wal');
    const b = await createSqliteRepository({ driver, clock });
    expect(await b.areas.get(area.id)).toEqual(area);
    expect(await b.tasks.count()).toBe(0);
    expect(await b.tasks.count({ includeDeleted: true })).toBe(1);
    expect(await b.opLog.latestSeq()).toBe(3);
    await b.areas.upsert({ ...area, name: 'Health & Fitness' });
    const entries = await b.opLog.since(3);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ seq: 4, op: 'update', patch: { name: 'Health & Fitness' } });
    await b.close();
  });

  it('uses the generated-column indexes for the hot queries', async () => {
    const driver = betterSqliteDriver();
    await createSqliteRepository({ driver });
    const plan = await driver.select<{ detail: string }>(
      "EXPLAIN QUERY PLAN SELECT data FROM tasks WHERE projectId = 'x' AND deletedAt IS NULL",
    );
    expect(plan.map((p) => p.detail).join(' ')).toMatch(/USING INDEX idx_tasks_projectId/);
    const links = await driver.select<{ detail: string }>(
      "EXPLAIN QUERY PLAN SELECT data FROM links WHERE fromType = 'task' AND fromId = 'x'",
    );
    expect(links.map((p) => p.detail).join(' ')).toMatch(/USING INDEX idx_links_from/);
    await driver.close();
  });
});

describe('SQLite migrations', () => {
  it('a fresh file reaches the latest version and a second open is a no-op', async () => {
    const driver = betterSqliteDriver();
    expect(await currentVersion(driver)).toBe(0);
    const first = await migrate(driver);
    expect(first).toEqual({ from: 0, to: SQLITE_SCHEMA_VERSION, applied: ['0001_init'] });
    const again = await migrate(driver);
    expect(again.applied).toEqual([]);
    expect(await currentVersion(driver)).toBe(SQLITE_SCHEMA_VERSION);
    await driver.close();
  });

  it('a v1 fixture file migrates forward through a later migration without losing rows', async () => {
    const fixture = readFileSync(
      new URL('../../../tests/fixtures/sqlite/v1.sql', import.meta.url),
      'utf8',
    );
    const driver = betterSqliteDriver();
    await driver.exec(fixture);
    expect(await currentVersion(driver)).toBe(1);
    const before = (await driver.select<{ c: number }>('SELECT count(*) AS c FROM tasks'))[0]!.c;
    expect(before).toBeGreaterThan(0);

    // A hypothetical next migration: an extra index. Existing data must survive.
    const next = {
      version: 2,
      name: '0002_task_energy_index',
      sql: `ALTER TABLE tasks ADD COLUMN energy TEXT GENERATED ALWAYS AS (json_extract(data, '$.energy')) VIRTUAL;
CREATE INDEX IF NOT EXISTS idx_tasks_energy ON tasks(energy);`,
    };
    const report = await migrate(driver, [...MIGRATIONS, next]);
    expect(report).toEqual({ from: 1, to: 2, applied: ['0002_task_energy_index'] });
    const after = (await driver.select<{ c: number }>('SELECT count(*) AS c FROM tasks'))[0]!.c;
    expect(after).toBe(before);
    expect(await currentVersion(driver)).toBe(2);
    const repo = await createSqliteRepository({ driver, skipMigrations: true });
    expect(await repo.tasks.count({ includeDeleted: true })).toBe(before);
    await repo.close();
  });

  it('refuses a file written by a newer Orbit', async () => {
    const driver = betterSqliteDriver();
    await driver.exec('PRAGMA user_version = 99');
    await expect(migrate(driver)).rejects.toThrow(/newer Orbit/);
    await driver.close();
  });

  it('a failing migration rolls back and leaves the version untouched', async () => {
    const driver = betterSqliteDriver();
    await migrate(driver);
    await expect(
      migrate(driver, [...MIGRATIONS, { version: 2, name: 'bad', sql: 'CREATE TABLE tasks(x)' }]),
    ).rejects.toThrow();
    expect(await currentVersion(driver)).toBe(1);
    await driver.close();
  });
});

describe('web → desktop import', () => {
  it('a web JSON export imports into SQLite with zero diff', async () => {
    const text = readFileSync(
      new URL(`../../../tests/fixtures/export/v${EXPORT_SCHEMA_VERSION}.json`, import.meta.url),
      'utf8',
    );
    const envelope = parseExport(text);
    const clock = fixedClock('2026-09-13T09:00:00.000Z');
    const repo = await createSqliteRepository({ driver: betterSqliteDriver(), clock });
    const report = await importJson(repo, envelope, { mode: 'replace' });
    expect(report.totals.update + report.totals.skip + report.totals.remove).toBe(0);
    const again = await exportJson(repo, clock);
    expect(again.data).toEqual(envelope.data);
    await repo.close();
  });
});

describe('integrity', () => {
  it('reports ok and FTS5 on a healthy file', async () => {
    const driver = betterSqliteDriver();
    await migrate(driver);
    const r = await integrityCheck(driver);
    expect(r).toEqual({ ok: true, messages: ['ok'], fts5: true });
    await driver.close();
  });

  it('detects a corrupt file and picks the newest non-empty backup to restore', async () => {
    const file = join(dir, 'corrupt.db');
    writeFileSync(file, 'this is not a database, just 40 bytes of junk...');
    const driver = betterSqliteDriver(file);
    const r = await integrityCheck(driver);
    expect(r.ok).toBe(false);
    expect(r.messages[0]).toMatch(/not a database/);
    await driver.close();

    expect(
      chooseRestore([
        { path: 'a.db', modifiedAt: '2026-09-10T00:00:00Z', sizeBytes: 100 },
        { path: 'b.db', modifiedAt: '2026-09-12T00:00:00Z', sizeBytes: 0 },
        { path: 'c.db', modifiedAt: '2026-09-11T00:00:00Z', sizeBytes: 100 },
      ])?.path,
    ).toBe('c.db');
    expect(chooseRestore([])).toBeNull();
  });
});
