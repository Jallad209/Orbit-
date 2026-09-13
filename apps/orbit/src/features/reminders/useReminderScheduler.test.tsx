import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { BillSchema, RuleSchema, createRecord, fixedClock } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { useToastStore } from '@/components/ui/toastStore';
import { webPlatform, type Platform } from '@/platform';
import { renderWithProviders } from '@/test/render';
import { REMINDER_POLL_MS, useReminderScheduler } from './useReminderScheduler';

// Monday 14 Sep 2026, 10:00 local: past the 09:00 fire time.
const clock = fixedClock(new Date(2026, 8, 14, 10, 0, 0));

function Bridge() {
  useReminderScheduler(clock);
  return null;
}

async function seed() {
  const repo = createMemoryRepository({ clock });
  const rule = createRecord(RuleSchema, clock, {
    type: 'reminder',
    name: 'Bills',
    config: { kind: 'billDueWithin', days: 3 },
  });
  const rent = createRecord(BillSchema, clock, { title: 'Rent', amount: 900, dueAt: '2026-09-15' });
  const later = createRecord(BillSchema, clock, { title: 'Gym', amount: 40, dueAt: '2026-10-01' });
  await repo.rules.upsert(rule);
  await repo.bills.upsert(rent);
  await repo.bills.upsert(later);
  return { repo, rule, rent };
}

describe('useReminderScheduler', () => {
  beforeEach(() => useToastStore.getState().clear());
  afterEach(() => vi.useRealTimers());

  it('on the web fills the queue, fires due reminders as toasts once, and marks them fired', async () => {
    const { repo, rent } = await seed();
    const notify = vi.fn(async () => true);
    const platform: Platform = { ...webPlatform, notify };
    renderWithProviders(<Bridge />, { repository: repo, platform });

    await waitFor(async () => expect(await repo.reminders.count()).toBe(1));
    const [reminder] = await repo.reminders.list();
    expect(reminder).toMatchObject({
      entityId: rent.id,
      title: 'Rent due tomorrow',
      status: 'fired',
    });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ id: `reminder-${reminder!.id}`, title: 'Rent due tomorrow' });
    expect(notify).toHaveBeenCalledWith('Rent due tomorrow', 'Due 2026-09-15 · 900');

    // Dismiss from the toast action.
    await act(async () => toasts[0]!.action!.onClick());
    await waitFor(async () =>
      expect((await repo.reminders.get(reminder!.id))?.status).toBe('dismissed'),
    );
  });

  it('a later poll adds nothing for the same bill, and ticks on the interval', async () => {
    vi.useFakeTimers();
    const { repo } = await seed();
    renderWithProviders(<Bridge />, { repository: repo, platform: webPlatform });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(await repo.reminders.count()).toBe(1);
    clock.advance(REMINDER_POLL_MS);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REMINDER_POLL_MS + 10);
    });
    expect(await repo.reminders.count()).toBe(1);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    clock.set(new Date(2026, 8, 14, 10, 0, 0));
  });

  it('on desktop only fills the queue; the Rust scheduler delivers', async () => {
    const { repo } = await seed();
    const platform: Platform = {
      ...webPlatform,
      name: 'desktop',
      capabilities: { ...webPlatform.capabilities, nativeReminders: true, dataFolder: true },
    };
    renderWithProviders(<Bridge />, { repository: repo, platform });
    await waitFor(async () => expect(await repo.reminders.count()).toBe(1));
    expect((await repo.reminders.list())[0]?.status).toBe('pending');
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
