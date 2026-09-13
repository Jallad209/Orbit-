import { describe, expect, it } from 'vitest';
import { BillSchema, RuleSchema, createRecord, fixedClock } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import {
  claimReminder,
  loadDueReminders,
  markReminder,
  reconcileReminderQueue,
} from './reminderService';

async function seed() {
  const clock = fixedClock(new Date(2026, 8, 14, 8));
  const repo = createMemoryRepository({ clock });
  const bill = createRecord(BillSchema, clock, { title: 'Rent', amount: 900, dueAt: '2026-09-17' });
  const rule = createRecord(RuleSchema, clock, {
    type: 'reminder',
    config: { kind: 'billDueWithin', days: 3 },
  });
  await repo.bills.upsert(bill);
  await repo.rules.upsert(rule);
  return { repo, clock, bill, rule };
}

describe('reminder queue lifecycle', () => {
  it('cancels disabled rules, resumes on re-enable, and cancels paid bills', async () => {
    const { repo, clock, bill, rule } = await seed();
    await reconcileReminderQueue(repo, clock);
    const [original] = await repo.reminders.list();
    await repo.rules.upsert({ ...rule, enabled: false });
    await reconcileReminderQueue(repo, clock);
    clock.advance(2 * 60 * 60_000);
    expect(await loadDueReminders(repo, clock)).toEqual([]);
    await repo.rules.upsert(rule);
    await reconcileReminderQueue(repo, clock);
    expect((await loadDueReminders(repo, clock)).map((r) => r.id)).toEqual([original!.id]);
    await repo.bills.upsert({ ...bill, paid: true });
    await reconcileReminderQueue(repo, clock);
    expect(await loadDueReminders(repo, clock)).toEqual([]);
  });

  it('replaces stale due dates and updates pending content and source watermarks', async () => {
    const { repo, clock, bill } = await seed();
    await reconcileReminderQueue(repo, clock);
    clock.advance(1_000);
    await repo.bills.upsert({ ...bill, title: 'New rent', dueAt: '2026-09-16' });
    await reconcileReminderQueue(repo, clock);
    const live = await repo.reminders.list();
    expect(live).toHaveLength(1);
    expect(live[0]!.key).toContain('2026-09-16');
    expect(live[0]!.title).toContain('New rent');
    expect(live[0]!.updatedAt >= (await repo.bills.get(bill.id))!.updatedAt).toBe(true);
    expect(await repo.reminders.count({ includeDeleted: true })).toBe(2);
  });

  it('concurrent reconciliation and web claims each happen once', async () => {
    const { repo, clock } = await seed();
    await Promise.all(Array.from({ length: 5 }, () => reconcileReminderQueue(repo, clock)));
    expect(await repo.reminders.count()).toBe(1);
    const [reminder] = await repo.reminders.list();
    clock.advance(2 * 60 * 60_000);
    const claimed = await Promise.all([
      claimReminder(repo, reminder!, clock),
      claimReminder(repo, reminder!, clock),
    ]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
  });

  it('cleans older duplicate pending rows and never requeues dismissed history', async () => {
    const { repo, clock, bill } = await seed();
    await reconcileReminderQueue(repo, clock);
    const [reminder] = await repo.reminders.list();
    await repo.reminders.upsert({ ...reminder!, id: crypto.randomUUID() });
    await reconcileReminderQueue(repo, clock);
    expect(await repo.reminders.count()).toBe(1);
    const [canonical] = await repo.reminders.list();
    await markReminder(repo, canonical!, 'dismissed');
    await repo.bills.upsert({ ...bill, paid: true });
    await reconcileReminderQueue(repo, clock);
    await repo.bills.upsert(bill);
    await reconcileReminderQueue(repo, clock);
    expect((await repo.reminders.list())[0]!.status).toBe('dismissed');
  });
});
