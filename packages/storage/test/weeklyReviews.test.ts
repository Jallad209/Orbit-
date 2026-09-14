import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  BillSchema,
  COMMAND_STORES,
  WeeklyReviewActionSchema,
  createRecord,
  fixedClock,
  newWeeklyReview,
} from '@orbit/core';
import type { Bill, WeeklyReviewAction } from '@orbit/core';
import {
  EXPORT_SCHEMA_VERSION,
  STORE_ORDER,
  exportJson,
  importJson,
  parseExport,
} from '../src/export';
import { createIndexedDbRepository } from '../src/indexeddb';
import { createMemoryRepository } from '../src/memory';
import type { Repository } from '../src/repository';
import { SEARCHABLE_TYPES } from '../src/search/types';
import { createSqliteRepository, tablesAtVersion } from '../src/sqlite';
import { betterSqliteDriver } from './betterSqliteDriver';

/**
 * Week 12 stores across every adapter: weekly reviews and their receipts
 * round-trip, commit or roll back together, and stay out of search and
 * generic undo; old files come in with empty review stores and their
 * recurring bills normalized as series roots.
 */
const FIXTURES = new URL('../../../tests/fixtures/', import.meta.url);
const clock = fixedClock('2026-09-12T09:00:00.000Z');

const adapters: Array<[string, () => Promise<Repository>]> = [
  ['memory', async () => createMemoryRepository({ clock })],
  [
    'indexeddb',
    async () =>
      createIndexedDbRepository({
        name: `orbit-week12-${Math.random()}`,
        clock,
        indexedDB: new IDBFactory(),
        IDBKeyRange,
      }),
  ],
  ['sqlite', async () => createSqliteRepository({ driver: betterSqliteDriver(), clock })],
];

function receipt(reviewId: string, at = '2026-09-12T09:00:00.000Z'): WeeklyReviewAction {
  return createRecord(WeeklyReviewActionSchema, clock, {
    reviewId,
    step: 'inbox',
    kind: 'acknowledge',
    refs: [],
    choice: {},
    result: {},
    at,
  });
}

for (const [name, open] of adapters) {
  describe(`weekly reviews on ${name}`, () => {
    it('round-trips a review with its receipts and logs them under their own entity names', async () => {
      const repo = await open();
      const review = newWeeklyReview(clock, '2026-09-12');
      await repo.weeklyReviews.upsert(review);
      const a = await repo.weeklyReviewActions.upsert(receipt(review.id));
      expect(await repo.weeklyReviews.get(review.id)).toEqual(review);
      expect(await repo.weeklyReviewActions.query((r) => r.reviewId === review.id)).toEqual([a]);
      const log = await repo.opLog.since(0);
      expect(log.map((e) => e.entity)).toEqual(['weeklyReview', 'weeklyReviewAction']);
      expect(log[0]!.op).toBe('create');
      await repo.close();
    });

    it('a receipt and its domain change commit or roll back together', async () => {
      const repo = await open();
      const review = await repo.weeklyReviews.upsert(newWeeklyReview(clock, '2026-09-12'));
      const bill = await repo.bills.upsert(
        createRecord(BillSchema, clock, { title: 'Rent', amount: 900, dueAt: '2026-09-20' }),
      );
      await expect(
        repo.transaction(async (tx) => {
          await tx.bills.upsert({ ...bill, paid: true, paidAt: clock.now().toISOString() });
          await tx.weeklyReviewActions.upsert(receipt(review.id));
          await tx.weeklyReviews.upsert({ ...review, revision: review.revision + 1 });
          throw new Error('progress write failed');
        }),
      ).rejects.toThrow('progress write failed');
      expect((await repo.bills.get(bill.id))?.paid).toBe(false);
      expect(await repo.weeklyReviewActions.count()).toBe(0);
      expect((await repo.weeklyReviews.get(review.id))?.revision).toBe(1);
      // Nothing from the failed attempt reached the op log either.
      const entities = (await repo.opLog.since(0)).map((e) => e.entity);
      expect(entities.filter((e) => e === 'weeklyReviewAction')).toHaveLength(0);
      await repo.close();
    });

    it('a legacy recurring bill reads back as its own series root without a successor', async () => {
      const repo = await open();
      const plain = createRecord(BillSchema, clock, {
        title: 'Gym',
        amount: 30,
        dueAt: '2026-09-01',
        paid: true,
      });
      // Write the raw week-9 shape past validation through the transaction's store.
      const legacy = {
        ...plain,
        recurrence: {
          freq: 'weekly',
          interval: 1,
          byDay: [],
          byMonthDay: null,
          count: null,
          until: null,
        },
      };
      delete (legacy as Partial<Bill>).seriesId;
      delete (legacy as Partial<Bill>).recurrenceAnchor;
      delete (legacy as Partial<Bill>).scheduledFor;
      delete (legacy as Partial<Bill>).occurrenceIndex;
      delete (legacy as Partial<Bill>).paidAt;
      delete (legacy as Partial<Bill>).nextBillId;
      delete (legacy as Partial<Bill>).repeatStopped;
      await repo.bills.upsert(legacy as Bill, { preserveUpdatedAt: true });
      const read = await repo.bills.get(plain.id);
      expect(read).toMatchObject({
        seriesId: plain.id,
        recurrenceAnchor: '2026-09-01',
        scheduledFor: '2026-09-01',
        occurrenceIndex: 0,
        paidAt: null,
        nextBillId: null,
        repeatStopped: false,
      });
      expect((await repo.bills.list({ includeDeleted: true }))[0]).toEqual(read);
      expect(await repo.bills.query((b) => b.seriesId === plain.id)).toHaveLength(1);
      await repo.close();
    });
  });
}

describe('week 12 switches', () => {
  it('reviews are neither searchable nor generically undoable', () => {
    expect(SEARCHABLE_TYPES).not.toContain('weeklyReview');
    expect(Object.keys(COMMAND_STORES)).not.toContain('weeklyReview');
    expect(Object.keys(COMMAND_STORES)).not.toContain('weeklyReviewAction');
  });

  it('every export version before 5 imports with empty review stores and normalized bills', () => {
    for (const version of [1, 2, 3, 4]) {
      const text = readFileSync(new URL(`export/v${version}.json`, FIXTURES), 'utf8');
      const envelope = parseExport(text);
      expect(envelope.data.weeklyReviews).toEqual([]);
      expect(envelope.data.weeklyReviewActions).toEqual([]);
      for (const bill of envelope.data.bills as Bill[]) {
        expect(bill.occurrenceIndex).toBe(0);
        expect(bill.repeatStopped).toBe(false);
        if (bill.recurrence) expect(bill.seriesId).toBe(bill.id);
      }
    }
  });

  it('the current export carries reviews, receipts, and bill lineage losslessly', async () => {
    const text = readFileSync(new URL(`export/v${EXPORT_SCHEMA_VERSION}.json`, FIXTURES), 'utf8');
    const envelope = parseExport(text);
    expect(envelope.schemaVersion).toBe(5);
    expect(envelope.data.weeklyReviews.length).toBeGreaterThan(0);
    expect(envelope.data.weeklyReviewActions.length).toBeGreaterThan(0);
    const bills = envelope.data.bills as Bill[];
    const paid = bills.find((b) => b.nextBillId !== null);
    expect(paid).toBeDefined();
    expect(bills.find((b) => b.id === paid!.nextBillId)).toMatchObject({
      seriesId: paid!.seriesId,
      occurrenceIndex: paid!.occurrenceIndex + 1,
    });
    const repo = createMemoryRepository({ clock });
    await importJson(repo, envelope, { mode: 'replace' });
    const again = await exportJson(repo, clock);
    for (const name of STORE_ORDER)
      expect(JSON.stringify(again.data[name])).toBe(JSON.stringify(envelope.data[name]));
  });

  it('names the tables a file at each schema version holds', () => {
    expect(tablesAtVersion(1)).not.toContain('reminders');
    expect(tablesAtVersion(2)).toContain('appSettings');
    expect(tablesAtVersion(2)).not.toContain('weeklyReviews');
    expect(tablesAtVersion(3)).toEqual(
      expect.arrayContaining(['weeklyReviews', 'weeklyReviewActions']),
    );
  });
});
