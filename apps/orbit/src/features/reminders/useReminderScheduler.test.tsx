import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { BillSchema, ReminderSchema, RuleSchema, createRecord, fixedClock } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { useLocation } from 'react-router';
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

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname + location.search}</span>;
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

    // Both bills are prepared; only the rent is due (the gym row waits with its future fire time).
    await waitFor(async () => expect(await repo.reminders.count()).toBe(2));
    const reminder = (await repo.reminders.list()).find((r) => r.entityId === rent.id);
    await waitFor(async () =>
      expect((await repo.reminders.get(reminder!.id))?.status).toBe('fired'),
    );
    expect(reminder).toMatchObject({ entityId: rent.id, title: 'Rent due 2026-09-15' });
    const gym = (await repo.reminders.list()).find((r) => r.entityId !== rent.id)!;
    expect(gym).toMatchObject({ status: 'pending', title: 'Gym due 2026-10-01' });
    expect(gym.fireAt > clock.now().toISOString()).toBe(true);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      id: `reminder-${reminder!.id}`,
      title: 'Rent due 2026-09-15',
    });
    expect(notify).toHaveBeenCalledWith('Rent due 2026-09-15', '900');

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
    expect(await repo.reminders.count()).toBe(2);
    clock.advance(REMINDER_POLL_MS);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REMINDER_POLL_MS + 10);
    });
    expect(await repo.reminders.count()).toBe(2);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    clock.set(new Date(2026, 8, 14, 10, 0, 0));
  });

  it('opens a direct reminder with router navigation and keeps a dismiss action', async () => {
    const repo = createMemoryRepository({ clock });
    const reminder = await repo.reminders.upsert(
      createRecord(ReminderSchema, clock, {
        key: 'review-step:2026-09-14:project',
        source: 'review-step',
        entityType: 'dailyReviewDraft',
        entityId: '01a0a1b6-3ad4-7678-92cc-ae55e388b0a6',
        fireAt: '2026-09-14T06:00:00.000Z',
        title: 'Morning briefing · Projects',
        destination: '/review/morning?date=2026-09-14&step=project',
      }),
    );
    renderWithProviders(
      <>
        <Bridge />
        <LocationProbe />
      </>,
      { repository: repo, route: '/today' },
    );

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const shown = useToastStore.getState().toasts[0]!;
    expect(shown.action?.label).toBe('Open');
    expect(shown.secondaryAction?.label).toBe('Dismiss');
    await act(async () => shown.action!.onClick());
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/review/morning?date=2026-09-14&step=project',
    );
    await waitFor(async () =>
      expect((await repo.reminders.get(reminder.id))?.status).toBe('dismissed'),
    );
  });

  it('on desktop only fills the queue; the Rust scheduler delivers', async () => {
    const { repo } = await seed();
    const platform: Platform = {
      ...webPlatform,
      name: 'desktop',
      capabilities: { ...webPlatform.capabilities, nativeReminders: true, dataFolder: true },
    };
    renderWithProviders(<Bridge />, { repository: repo, platform });
    await waitFor(async () => expect(await repo.reminders.count()).toBe(2));
    expect((await repo.reminders.list()).map((r) => r.status)).toEqual(['pending', 'pending']);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
