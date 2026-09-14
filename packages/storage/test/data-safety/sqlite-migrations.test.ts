import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { CaptureSchema, createRecord, fixedClock, newWeeklyReview } from '@orbit/core';
import type { BaseRecord, Bill } from '@orbit/core';
import { STORE_ORDER } from '../../src/export';
import type { EntityStore, StoreName } from '../../src/repository';
import {
  SQLITE_SCHEMA_VERSION,
  createSqliteRepository,
  currentVersion,
  integrityCheck,
  migrate,
} from '../../src/sqlite';
import { betterSqliteDriver } from '../betterSqliteDriver';

/**
 * SQLite migration matrix (DEVOPS-TASKS week 8), the desktop twin of the
 * IndexedDB matrix. For every `.db` fixture (a real file written at that
 * schema version by `pnpm run make:fixture`): copy it aside, open it with
 * today's adapter, migrate, run the integrity check, and assert every table
 * still holds the rows the matching SQL dump inserted.
 */
const FIXTURES = new URL('../../../../tests/fixtures/', import.meta.url);
const clock = fixedClock('2026-09-12T09:00:00.000Z');
const dir = mkdtempSync(join(tmpdir(), 'orbit-db-matrix-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function dbFixtures(): string[] {
  return readdirSync(new URL('db/', FIXTURES))
    .filter((f) => /^v\d+\.db$/.test(f))
    .sort((a, b) => Number(a.slice(1, -3)) - Number(b.slice(1, -3)));
}

/** Rows per table the dump of that version inserted: the ground truth for the matrix. */
function expectedCounts(version: number): Map<StoreName, number> {
  const sql = readFileSync(new URL(`sqlite/v${version}.sql`, FIXTURES), 'utf8');
  const counts = new Map<StoreName, number>();
  for (const name of STORE_ORDER) counts.set(name, 0);
  for (const line of sql.split('\n')) {
    const m = /^INSERT INTO (\w+)\(/.exec(line);
    if (m) counts.set(m[1] as StoreName, (counts.get(m[1] as StoreName) ?? 0) + 1);
  }
  return counts;
}

describe('SQLite fixture databases', () => {
  const files = dbFixtures();

  it('has a fixture for the current schema version', () => {
    expect(files).toContain(`v${SQLITE_SCHEMA_VERSION}.db`);
  });

  for (const file of files) {
    const version = Number(file.slice(1, -3));
    it(`migrates ${file} to v${SQLITE_SCHEMA_VERSION}, passes the integrity check, and keeps every row`, async () => {
      // Never touch the committed fixture: work on a copy.
      const copy = join(dir, `${file}-${Date.now()}.db`);
      copyFileSync(fileURLToPath(new URL(`db/${file}`, FIXTURES)), copy);
      const driver = betterSqliteDriver(copy);
      expect(await currentVersion(driver)).toBe(version);

      const before = await integrityCheck(driver);
      expect(before.ok, before.messages.join('\n')).toBe(true);
      const report = await migrate(driver);
      expect(report.from).toBe(version);
      expect(report.to).toBe(SQLITE_SCHEMA_VERSION);
      const after = await integrityCheck(driver);
      expect(after.ok, after.messages.join('\n')).toBe(true);

      const expected = expectedCounts(version);
      const repo = await createSqliteRepository({ driver, clock, skipMigrations: true });
      let total = 0;
      for (const name of STORE_ORDER) {
        const store = repo[name] as unknown as EntityStore<BaseRecord>;
        const rows = await store.count({ includeDeleted: true });
        expect(rows, name).toBe(expected.get(name));
        total += rows;
      }
      expect(total).toBeGreaterThan(0);
      // The migrated file is fully usable straight away.
      await repo.captures.upsert(
        createRecord(CaptureSchema, clock, { text: 'after upgrade', type: 'task' }),
      );
      expect(await repo.captures.count()).toBe((expected.get('captures') ?? 0) + 1);
      // Week 12: reviews, people, bills, and notes open on the migrated file; old recurring
      // bills read as series roots without anything being generated.
      const review = newWeeklyReview(clock, '2026-09-12');
      await repo.weeklyReviews.upsert(review);
      expect(await repo.weeklyReviews.get(review.id)).toEqual(review);
      expect(await repo.weeklyReviewActions.count()).toBe(expected.get('weeklyReviewActions'));
      expect((await repo.people.list()).length + (await repo.notes.list()).length).toBeGreaterThan(
        0,
      );
      const billsBefore = expected.get('bills');
      const bills = (await repo.bills.list({ includeDeleted: true })) as Bill[];
      expect(bills).toHaveLength(billsBefore ?? 0);
      for (const bill of bills) if (bill.recurrence) expect(bill.seriesId).not.toBeNull();
      await repo.close();
    });
  }
});
