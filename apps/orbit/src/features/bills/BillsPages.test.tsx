import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuleSchema, createRecord, fixedClock, toLocalDate } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { useToastStore } from '@/components/ui/toastStore';
import { reconcileReminderQueue } from '@/features/reminders/reminderService';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/render';
import { createBill } from './billsService';

const monthly = {
  freq: 'monthly' as const,
  interval: 1,
  byDay: [],
  byMonthDay: null,
  count: null,
  until: null,
};

/** The pages run on the system clock; the fixture is placed relative to today. */
function shift(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

async function seed() {
  const clock = fixedClock(new Date());
  const repo = createMemoryRepository({ clock });
  await repo.rules.upsert(
    createRecord(RuleSchema, clock, {
      type: 'reminder',
      name: 'Bills',
      config: { kind: 'billDueWithin', days: 3 },
    }),
  );
  const late = await createBill(
    repo,
    { title: 'Electricity', amount: 60, currency: 'USD', dueAt: shift(-2), recurrence: null },
    clock,
  );
  const soon = await createBill(
    repo,
    { title: 'Water', amount: 12.5, currency: 'JOD', dueAt: shift(3), recurrence: null },
    clock,
  );
  const later = await createBill(
    repo,
    { title: 'Insurance', amount: 200, currency: 'USD', dueAt: shift(20), recurrence: null },
    clock,
  );
  const rent = await createBill(
    repo,
    { title: 'Rent', amount: 900, currency: 'USD', dueAt: shift(10), recurrence: monthly },
    clock,
  );
  await reconcileReminderQueue(repo, clock);
  return { clock, repo, late, soon, later, rent };
}

describe('Bills pages', () => {
  it('logs repeated spending names and combines them in the weekly total', async () => {
    const repo = createMemoryRepository({ clock: fixedClock(new Date()) });
    renderWithProviders(<AppRoutes />, { repository: repo, route: '/bills' });

    await userEvent.click(await screen.findByRole('button', { name: 'Add spending' }));
    const add = async (name: string, amount: string) => {
      await userEvent.type(screen.getByLabelText('Item'), name);
      await userEvent.type(screen.getByLabelText('Amount (JOD)'), amount);
      await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    };
    await add('Food', '5');
    await waitFor(() => expect(screen.getByLabelText('Item')).toHaveValue(''));
    await add('food', '15');

    const weekly = await screen.findByRole('list', { name: 'This week spending breakdown' });
    expect(weekly).toHaveTextContent('Food');
    expect(weekly).toHaveTextContent('2 items');
    expect(weekly).toHaveTextContent('20.00 JOD');
    expect(await repo.bills.query((bill) => bill.kind === 'expense')).toHaveLength(2);
  });

  it('uses one clear empty state and reveals the create form on demand', async () => {
    const repo = createMemoryRepository({ clock: fixedClock(new Date()) });
    renderWithProviders(<AppRoutes />, { repository: repo, route: '/bills' });

    expect(await screen.findByText('No unpaid bills')).toBeInTheDocument();
    expect(screen.queryByTestId('bills-overdue')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add bill' }));
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('groups by overdue, due soon, and upcoming with per-currency totals and reminder status', async () => {
    const { repo } = await seed();
    renderWithProviders(<AppRoutes />, { repository: repo, route: '/bills' });
    const overdue = await screen.findByTestId('bills-overdue');
    expect(within(overdue).getAllByTestId('bill-row')).toHaveLength(1);
    expect(overdue).toHaveTextContent('60.00 USD');
    const soon = screen.getByTestId('bills-due-soon');
    expect(within(soon).getAllByTestId('bill-row')).toHaveLength(1);
    expect(soon).toHaveTextContent('12.50 JOD');
    const upcoming = screen.getByTestId('bills-upcoming');
    expect(within(upcoming).getAllByTestId('bill-row')).toHaveLength(2);
    // USD and JOD are never one number.
    expect(upcoming).toHaveTextContent('1100.00 USD');
    expect(upcoming).not.toHaveTextContent('JOD');
    expect(within(upcoming).getAllByTestId('bill-reminder')[0]).toHaveTextContent(
      /reminder \d{4}-\d{2}-\d{2}/,
    );
    expect(upcoming).toHaveTextContent('Monthly on the');
  });

  it('creates a recurring bill from the form only when the first date agrees with the rule', async () => {
    const { repo } = await seed();
    renderWithProviders(<AppRoutes />, { repository: repo, route: '/bills' });
    await screen.findByTestId('bills-overdue');
    await userEvent.click(screen.getByRole('button', { name: 'Add bill' }));
    await userEvent.type(screen.getByLabelText('Title'), 'Gym');
    await userEvent.type(screen.getByLabelText('Amount'), '35');
    await userEvent.type(screen.getByLabelText(/^Currency/), 'usd');
    await userEvent.selectOptions(screen.getByLabelText('Repeats'), 'weekly');
    // 2026-09-14 is a Monday; choosing Tuesday only contradicts it.
    await userEvent.type(screen.getByLabelText('First due date'), '2026-09-14');
    await userEvent.click(screen.getByRole('button', { name: 'Tue' }));
    expect(screen.getByTestId('bill-preview')).toHaveTextContent('Change the date or the days');
    await userEvent.click(screen.getByRole('button', { name: 'Add bill' }));
    expect(await repo.bills.count()).toBe(4);
    await userEvent.click(screen.getByRole('button', { name: 'Mon' }));
    expect(screen.getByTestId('bill-preview')).toHaveTextContent(
      'Weekly on Mon, Tue: first on 2026-09-14, then 2026-09-15 and 2026-09-21',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add bill' }));
    await waitFor(async () => expect(await repo.bills.count()).toBe(5));
    const gym = (await repo.bills.query((b) => b.title === 'Gym'))[0]!;
    expect(gym).toMatchObject({
      currency: 'USD',
      seriesId: gym.id,
      recurrenceAnchor: '2026-09-14',
      occurrenceIndex: 0,
    });
  });

  it('marks an occurrence paid, shows the successor, keeps history read-only, and stops repeating', async () => {
    const { repo, rent } = await seed();
    useToastStore.getState().clear();
    renderWithProviders(<AppRoutes />, { repository: repo, route: `/bills/${rent.id}` });
    expect(await screen.findByTestId('bill-schedule')).toHaveTextContent('Monthly on the');
    expect(screen.getByTestId('bill-position')).toHaveTextContent('Occurrence 1');
    expect(screen.getByTestId('pay-card')).toHaveTextContent('creates the next occurrence');
    await userEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(screen.getByTestId('bill-status')).toHaveTextContent('Paid'));
    const toastEntry = useToastStore.getState().toasts.at(-1)!;
    expect(toastEntry.title).toBe('Marked paid');
    const successor = (await repo.bills.query((b) => b.occurrenceIndex === 1))[0]!;
    expect(toastEntry.description).toBe(`Next occurrence: ${successor.dueAt}.`);
    expect(screen.getByText('This payment is history:', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `due ${successor.dueAt}` })).toHaveAttribute(
      'href',
      `/bills/${successor.id}`,
    );
    expect(screen.queryByRole('button', { name: 'Return to unpaid' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Occurrences' })).toHaveTextContent('#2');

    // The successor is the latest unpaid: it can stop the series.
    await userEvent.click(screen.getByRole('link', { name: `due ${successor.dueAt}` }));
    expect(await screen.findByTestId('bill-position')).toHaveTextContent('Occurrence 2');
    await userEvent.click(screen.getByRole('button', { name: 'Stop repeating' }));
    await waitFor(() => expect(screen.getByText('Repeat stopped')).toBeInTheDocument());
    expect((await repo.bills.get(successor.id))!.repeatStopped).toBe(true);
    expect(screen.getByTestId('pay-card')).toHaveTextContent('Repeat is stopped; nothing follows.');
  });

  it('edits only this deadline with a visible save state, and a one-off payment can be corrected', async () => {
    const { repo, rent } = await seed();
    renderWithProviders(<AppRoutes />, { repository: repo, route: `/bills/${rent.id}` });
    await screen.findByTestId('bill-schedule');
    const due = screen.getByLabelText('Deadline for this occurrence');
    const moved = shift(12);
    await userEvent.clear(due);
    await userEvent.type(due, moved);
    expect(screen.getByTestId('bill-save-state')).toHaveTextContent('Unsaved changes');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByTestId('bill-save-state')).toHaveTextContent('Saved'));
    const stored = (await repo.bills.get(rent.id))!;
    expect(stored.dueAt).toBe(moved);
    expect(stored.scheduledFor).toBe(rent.dueAt);
    expect(screen.getByTestId('bill-position')).toHaveTextContent(
      `scheduled for ${rent.dueAt}, deadline moved to ${moved}`,
    );
  });

  it('a one-off payment can be returned to unpaid as a correction', async () => {
    const { repo, late } = await seed();
    renderWithProviders(<AppRoutes />, { repository: repo, route: `/bills/${late.id}` });
    await screen.findByTestId('pay-card');
    expect(screen.getByTestId('pay-card')).toHaveTextContent('Nothing else is created.');
    await userEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    const back = await screen.findByRole('button', { name: 'Return to unpaid' });
    expect((await repo.bills.get(late.id))!.paid).toBe(true);
    await userEvent.click(back);
    await waitFor(async () => expect((await repo.bills.get(late.id))!.paid).toBe(false));
    expect(await screen.findByTestId('pay-card')).toBeInTheDocument();
  });

  it('confirms deletion with the consequence and restores from the list', async () => {
    const { repo, rent } = await seed();
    renderWithProviders(<AppRoutes />, { repository: repo, route: `/bills/${rent.id}` });
    await screen.findByTestId('bill-schedule');
    await userEvent.click(screen.getByRole('button', { name: 'Delete this bill' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('deleting it stops the series');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Rent was deleted')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore bill' }));
    expect(await screen.findByTestId('bill-schedule')).toBeInTheDocument();
    expect((await repo.bills.get(rent.id))!.deletedAt).toBeNull();
  });
});
