import { describe, expect, it } from 'vitest';
import { fixedClock } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { createSpendingItem, loadSpending } from './spendingService';

describe('spending log', () => {
  it('combines matching names and keeps a monthly summary reminder current', async () => {
    const clock = fixedClock(new Date(2026, 8, 16, 12, 0));
    const repo = createMemoryRepository({ clock });
    await createSpendingItem(repo, { name: 'Food', amount: 5, spentOn: '2026-09-16' }, clock);
    await createSpendingItem(repo, { name: ' food ', amount: 15, spentOn: '2026-09-17' }, clock);
    await createSpendingItem(
      repo,
      { name: 'Transport', amount: 3.5, spentOn: '2026-09-17' },
      clock,
    );

    const view = await loadSpending(repo, clock);
    expect(view.month.total).toBe(23.5);
    expect(view.month.groups).toEqual([
      { key: 'food', label: 'Food', count: 2, total: 20 },
      { key: 'transport', label: 'Transport', count: 1, total: 3.5 },
    ]);
    const reminder = (await repo.reminders.list())[0]!;
    expect(reminder).toMatchObject({
      key: 'monthly-spending:2026-09',
      source: 'monthly-spending',
      destination: '/bills?month=2026-09',
      status: 'pending',
    });
    expect(reminder.body).toContain('23.50 JOD total');
    expect(reminder.body).toContain('Food 20.00 JOD');
  });

  it('shows the previous month summary on the first day of a month', async () => {
    const september = fixedClock(new Date(2026, 8, 20, 12, 0));
    const repo = createMemoryRepository({ clock: september });
    await createSpendingItem(repo, { name: 'Books', amount: 12, spentOn: '2026-09-20' }, september);
    const october = fixedClock(new Date(2026, 9, 1, 8, 0));
    const view = await loadSpending(repo, october);
    expect(view.isFirstDayOfMonth).toBe(true);
    expect(view.previousMonth.total).toBe(12);
    expect(view.previousMonth.groups[0]).toMatchObject({ label: 'Books', total: 12 });
  });
});
