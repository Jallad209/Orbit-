import { describe, expect, it } from 'vitest';
import { RuleSchema, createRecord, fixedClock, reminderKey } from '@orbit/core';
import type { Bill, FixedClock, Recurrence } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import type { Repository } from '@orbit/storage';
import {
  advanceLegacy,
  createBill,
  deleteBill,
  deletionNote,
  editBill,
  loadBill,
  loadBills,
  payBill,
  restoreBill,
  stopRepeating,
  unpayBill,
} from './billsService';

const fresh = (): FixedClock => fixedClock('2026-09-12T09:00:00.000Z'); // Sat 12 Sep 2026
const monthly: Recurrence = {
  freq: 'monthly',
  interval: 1,
  byDay: [],
  byMonthDay: null,
  count: null,
  until: null,
};

async function withRule(repo: Repository, clock: FixedClock) {
  return repo.rules.upsert(
    createRecord(RuleSchema, clock, {
      type: 'reminder',
      name: 'Bills',
      config: { kind: 'billDueWithin', days: 3 },
    }),
  );
}

const pendingKeys = async (repo: Repository) =>
  (await repo.reminders.query((r) => r.status === 'pending')).map((r) => r.key).sort();

describe('bills service', () => {
  it('creates a one-off and a series root, groups by the fixed due-soon rule, and totals per currency', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    await createBill(
      repo,
      { title: 'Late', amount: 10, currency: 'USD', dueAt: '2026-09-11', recurrence: null },
      clock,
    );
    await createBill(
      repo,
      { title: 'Soon', amount: 5.5, currency: 'JOD', dueAt: '2026-09-15', recurrence: null },
      clock,
    );
    await createBill(
      repo,
      { title: 'Later', amount: 20, currency: 'USD', dueAt: '2026-09-16', recurrence: null },
      clock,
    );
    const rent = await createBill(
      repo,
      { title: 'Rent', amount: 900, currency: 'USD', dueAt: '2026-09-30', recurrence: monthly },
      clock,
    );
    expect(rent).toMatchObject({
      seriesId: rent.id,
      recurrenceAnchor: '2026-09-30',
      scheduledFor: '2026-09-30',
      occurrenceIndex: 0,
    });
    const view = await loadBills(repo, clock);
    expect(view.today).toBe('2026-09-12');
    expect(view.groups.overdue.map((b) => b.title)).toEqual(['Late']);
    expect(view.groups.dueSoon.map((b) => b.title)).toEqual(['Soon']);
    expect(view.groups.upcoming.map((b) => b.title)).toEqual(['Later', 'Rent']);
    expect(view.totals.upcoming).toEqual([{ currency: 'USD', total: 920 }]);
    expect(view.totals.dueSoon).toEqual([{ currency: 'JOD', total: 5.5 }]);
    // Midnight rollover: the same data three days later.
    clock.advance(3 * 86_400_000);
    const later = await loadBills(repo, clock);
    expect(later.groups.overdue.map((b) => b.title)).toEqual(['Late']);
    expect(later.groups.dueSoon.map((b) => b.title)).toEqual(['Soon', 'Later']);
    await expect(
      createBill(
        repo,
        { title: '', amount: -1, currency: '', dueAt: 'x', recurrence: null },
        clock,
      ),
    ).rejects.toThrow('A title is required.');
  });

  it('pays atomically with one successor, reminders re-keyed, and replays instead of duplicating', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const rule = await withRule(repo, clock);
    const rent = await createBill(
      repo,
      { title: 'Rent', amount: 900, currency: 'USD', dueAt: '2026-08-31', recurrence: monthly },
      clock,
    );
    expect(await pendingKeys(repo)).toEqual([reminderKey(rule.id, rent.id, '2026-08-31')]);
    const first = await payBill(repo, rent, clock.now().toISOString(), { clock });
    expect(first.replayed).toBe(false);
    expect(first.paid).toMatchObject({
      paid: true,
      paidAt: clock.now().toISOString(),
      dueAt: '2026-08-31',
    });
    expect(first.successor).toMatchObject({ dueAt: '2026-09-30', occurrenceIndex: 1, paid: false });
    expect(first.paid.nextBillId).toBe(first.successor!.id);
    // The paid row's reminder is gone; the successor's is prepared.
    expect(await pendingKeys(repo)).toEqual([
      reminderKey(rule.id, first.successor!.id, '2026-09-30'),
    ]);
    // Double-click, retry, another window: the same result, no second successor.
    const again = await payBill(repo, rent, '2026-09-13T00:00:00.000Z', { clock });
    expect(again.replayed).toBe(true);
    expect(again.successor?.id).toBe(first.successor!.id);
    expect(await repo.bills.count()).toBe(2);
    const detail = (await loadBill(repo, first.successor!.id))!;
    expect(detail.predecessor?.id).toBe(rent.id);
    expect(detail.latestUnpaid).toBe(true);
    expect(detail.plan).toEqual({ kind: 'next', date: '2026-10-31', index: 2 });
  });

  it('a failure after the paid write rolls everything back, including reminders and the receipt', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    await withRule(repo, clock);
    const rent = await createBill(
      repo,
      { title: 'Rent', amount: 900, currency: 'USD', dueAt: '2026-08-31', recurrence: monthly },
      clock,
    );
    const before = await pendingKeys(repo);
    await expect(
      payBill(repo, rent, clock.now().toISOString(), {
        clock,
        within: async () => {
          throw new Error('receipt write failed');
        },
      }),
    ).rejects.toThrow('receipt write failed');
    expect((await repo.bills.get(rent.id))!.paid).toBe(false);
    expect(await repo.bills.count()).toBe(1);
    expect(await pendingKeys(repo)).toEqual(before);
    expect(
      (await repo.opLog.since(0)).filter((e) => e.entity === 'bill' && e.op === 'update'),
    ).toHaveLength(0);
  });

  it('edits move only this deadline; a very late payment still generates the missed installment', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const rent = await createBill(
      repo,
      { title: 'Rent', amount: 900, currency: 'USD', dueAt: '2026-01-31', recurrence: monthly },
      clock,
    );
    const edited = await editBill(repo, rent, { dueAt: '2026-02-10', amount: 950 }, clock);
    expect(edited).toMatchObject({ dueAt: '2026-02-10', scheduledFor: '2026-01-31', amount: 950 });
    const paid = await payBill(repo, edited, '2026-05-15T10:00:00.000Z', { clock });
    // February, already overdue, not May: missed installments are never skipped.
    expect(paid.successor).toMatchObject({
      dueAt: '2026-02-28',
      scheduledFor: '2026-02-28',
      amount: 950,
    });
    // A stale edit against a changed field is a conflict.
    await expect(editBill(repo, rent, { amount: 1 }, clock)).rejects.toMatchObject({
      code: 'changed',
    });
  });

  it('stop repeating, deleted successor, and the explicit legacy advancement', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const rent = await createBill(
      repo,
      { title: 'Rent', amount: 900, currency: 'USD', dueAt: '2026-08-31', recurrence: monthly },
      clock,
    );
    const { paid, successor } = await payBill(repo, rent, clock.now().toISOString(), { clock });
    await expect(stopRepeating(repo, paid, { clock })).rejects.toThrow(/latest unpaid/);
    const stopped = await stopRepeating(repo, successor!, { clock });
    expect(stopped.repeatStopped).toBe(true);
    expect(stopped.recurrence).toEqual(monthly);
    const paidStopped = await payBill(repo, stopped, clock.now().toISOString(), { clock });
    expect(paidStopped.successor).toBeNull();
    expect(paidStopped.plan).toEqual({ kind: 'stopped' });
    expect(await repo.bills.count()).toBe(2);
    // Retrying the old parent's payment never resurrects a deleted successor.
    await deleteBill(repo, successor!.id, clock);
    const replay = await payBill(repo, paid, clock.now().toISOString(), { clock });
    expect(replay.replayed).toBe(true);
    expect(replay.successor?.deletedAt).not.toBeNull();
    expect(await repo.bills.count()).toBe(1);
    const restored = await restoreBill(repo, successor!.id, clock);
    expect(restored.deletedAt).toBeNull();

    // A legacy paid row (no successor, no payment time) is advanced only on request.
    const legacy = await repo.bills.upsert({
      ...rent,
      id: '00000000-0000-7000-8000-00000000abcd',
      title: 'Gym (legacy)',
      dueAt: '2026-08-03',
      paid: true,
      paidAt: null,
      nextBillId: null,
      seriesId: null,
      recurrenceAnchor: null,
      scheduledFor: null,
      occurrenceIndex: 0,
      recurrence: { ...monthly, freq: 'weekly' },
    } as Bill);
    const detail = (await loadBill(repo, legacy.id))!;
    expect(detail.legacyPaid).toBe(true);
    expect(detail.bill.seriesId).toBe(legacy.id);
    expect(
      await loadBills(repo, clock).then((v) => v.groups.paid.some((b) => b.id === legacy.id)),
    ).toBe(true);
    const advanced = await advanceLegacy(repo, legacy, clock);
    expect(advanced.successor).toMatchObject({
      dueAt: '2026-08-10',
      occurrenceIndex: 1,
      title: 'Gym (legacy)',
    });
    expect((await repo.bills.get(legacy.id))!.nextBillId).toBe(advanced.successor!.id);
    const twice = await advanceLegacy(repo, legacy, clock);
    expect(twice.replayed).toBe(true);
    expect(twice.successor?.id).toBe(advanced.successor!.id);
  });

  it('unpay is a one-off correction only and deletion notes explain the consequence', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    await withRule(repo, clock);
    const one = await createBill(
      repo,
      { title: 'Dentist', amount: 80, currency: 'USD', dueAt: '2026-09-20', recurrence: null },
      clock,
    );
    const paidOne = await payBill(repo, one, clock.now().toISOString(), { clock });
    expect(paidOne.successor).toBeNull();
    expect(await pendingKeys(repo)).toEqual([]);
    const back = await unpayBill(repo, paidOne.paid, clock);
    expect(back).toMatchObject({ paid: false, paidAt: null });
    expect(await pendingKeys(repo)).toHaveLength(1);
    const rent = await createBill(
      repo,
      { title: 'Rent', amount: 900, currency: 'USD', dueAt: '2026-09-30', recurrence: monthly },
      clock,
    );
    const { paid } = await payBill(repo, rent, clock.now().toISOString(), { clock });
    await expect(unpayBill(repo, paid, clock)).rejects.toThrow(/next occurrence/);
    expect(await deletionNote(repo, one)).toMatch(/Only this bill/);
    const latest = (await repo.bills.get(paid.nextBillId!))!;
    expect(await deletionNote(repo, latest)).toMatch(/stops the series/);
    expect(await deletionNote(repo, paid)).toMatch(/Only this bill/);
  });
});
