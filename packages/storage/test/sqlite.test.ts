import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  AreaSchema,
  TaskSchema,
  activeSession,
  createRecord,
  fixedClock,
  sessionMinutes,
  startSession,
} from '@orbit/core';
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
  it('queues independent writes and reads behind a transaction that rolls back', async () => {
    const clock = fixedClock('2026-09-14T08:00:00Z');
    const repo = await createSqliteRepository({ driver: betterSqliteDriver(), clock });
    const inside = createRecord(TaskSchema, clock, { title: 'Roll back' });
    const outside = createRecord(TaskSchema, clock, { title: 'Keep' });
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((r) => {
      entered = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const transaction = repo
      .transaction(async (tx) => {
        await tx.tasks.upsert(inside);
        entered();
        await gate;
        throw new Error('cancel only this transaction');
      })
      .catch(() => undefined);
    await ready;
    let wrote = false;
    const write = repo.tasks.upsert(outside).then(() => {
      wrote = true;
    });
    const read = repo.tasks.get(inside.id);
    await Promise.resolve();
    expect(wrote).toBe(false);
    clock.advance(1_000);
    release();
    await transaction;
    await write;
    expect(await read).toBeUndefined();
    expect(await repo.tasks.get(outside.id)).toEqual(expect.objectContaining({ title: 'Keep' }));
    expect((await repo.tasks.get(outside.id))!.updatedAt).toBe(clock.now().toISOString());
    expect(await repo.opLog.latestSeq()).toBe(1);
    await repo.close();
  });

  it('rejects a retained transaction repository after completion', async () => {
    const repo = await createSqliteRepository({ driver: betterSqliteDriver() });
    const tx = await repo.transaction(async (scoped) => scoped);
    await expect(tx.tasks.list()).rejects.toThrow('finished');
    await repo.close();
  });

  it('recovers after BEGIN fails and still rolls back subsequent failed writes', async () => {
    const driver = betterSqliteDriver();
    const repo = await createSqliteRepository({ driver });
    const task = createRecord(TaskSchema, fixedClock('2026-09-14T08:00:00Z'), { title: 'Atomic' });
    const exec = vi.spyOn(driver, 'exec');
    exec.mockRejectedValueOnce(new Error('database busy'));
    await expect(repo.tasks.upsert(task)).rejects.toThrow('database busy');
    expect(await repo.tasks.count()).toBe(0);
    expect(exec.mock.calls).toEqual([['BEGIN IMMEDIATE']]);

    await expect(
      repo.transaction(async (tx) => {
        await tx.tasks.upsert(task);
        throw new Error('cancel the write');
      }),
    ).rejects.toThrow('cancel the write');
    expect(await repo.tasks.count()).toBe(0);
    expect(await repo.opLog.latestSeq()).toBe(0);
    await repo.tasks.upsert(task);
    expect(await repo.tasks.get(task.id)).toMatchObject({ title: 'Atomic' });
    expect(await repo.opLog.latestSeq()).toBe(1);
    await repo.close();
  });

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
    expect(first).toEqual({
      from: 0,
      to: SQLITE_SCHEMA_VERSION,
      applied: ['0001_init', '0002_reminders'],
    });
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

    // The real 0002 plus a hypothetical next migration: an extra index. Existing data must survive.
    const next = {
      version: 3,
      name: '0003_task_energy_index',
      sql: `ALTER TABLE tasks ADD COLUMN energy TEXT GENERATED ALWAYS AS (json_extract(data, '$.energy')) VIRTUAL;
CREATE INDEX IF NOT EXISTS idx_tasks_energy ON tasks(energy);`,
    };
    const report = await migrate(driver, [...MIGRATIONS, next]);
    expect(report).toEqual({
      from: 1,
      to: 3,
      applied: ['0002_reminders', '0003_task_energy_index'],
    });
    const after = (await driver.select<{ c: number }>('SELECT count(*) AS c FROM tasks'))[0]!.c;
    expect(after).toBe(before);
    expect(await currentVersion(driver)).toBe(3);
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
      migrate(driver, [...MIGRATIONS, { version: 3, name: 'bad', sql: 'CREATE TABLE tasks(x)' }]),
    ).rejects.toThrow();
    expect(await currentVersion(driver)).toBe(SQLITE_SCHEMA_VERSION);
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

  it('reports damage inside a valid file as corruption, not as "not a database"', async () => {
    // A real database with enough rows to span many pages.
    const file = join(dir, 'flipped.db');
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const driver = betterSqliteDriver(file);
    await driver.exec('PRAGMA journal_mode = DELETE');
    const repo = await createSqliteRepository({ driver, clock });
    await repo.transaction(async (tx) => {
      for (let i = 0; i < 400; i += 1) {
        await tx.tasks.upsert(
          createRecord(TaskSchema, clock, { title: `Task ${i}`, notes: 'x'.repeat(200) }),
        );
      }
    });
    await repo.close();

    // Flip bytes in the middle of the file: the b-tree headers and cell
    // pointers of a few pages in the middle third, leaving page 1 intact.
    const bytes = readFileSync(file);
    const pageSize = bytes.readUInt16BE(16);
    const pages = Math.floor(bytes.length / pageSize);
    expect(pages).toBeGreaterThan(6);
    const first = Math.floor(pages / 3);
    for (let p = first; p < first + 3; p += 1) {
      const start = p * pageSize;
      for (let i = 0; i < 64; i += 1) bytes[start + i] = bytes[start + i]! ^ 0xa5;
    }
    writeFileSync(file, bytes);

    const damaged = betterSqliteDriver(file);
    const r = await integrityCheck(damaged);
    expect(r.ok).toBe(false);
    const report = r.messages.join('\n');
    expect(report).not.toMatch(/not a database/);
    expect(report).toMatch(/page \d+|malformed|corrupt/i);
    await damaged.close();
  });

  it('a running session started before a "restart" is found by the next connection', async () => {
    const file = join(dir, 'restart.db');
    const clock = fixedClock('2026-09-14T09:00:00.000Z');
    const task = createRecord(TaskSchema, clock, { title: 'Write intro' });
    const before = await createSqliteRepository({ driver: betterSqliteDriver(file), clock });
    await before.tasks.upsert(task);
    const { session } = startSession(task.id, [], clock);
    await before.sessions.upsert(session);
    await before.close(); // the app quits with the timer running

    clock.advance(25 * 60_000);
    const after = await createSqliteRepository({ driver: betterSqliteDriver(file), clock });
    const active = activeSession(await after.sessions.list());
    expect(active?.id).toBe(session.id);
    expect(sessionMinutes(active!, clock.now())).toBe(25);
    await after.close();
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
