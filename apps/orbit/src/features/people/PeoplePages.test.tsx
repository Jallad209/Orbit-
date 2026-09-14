import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CommitmentSchema,
  PersonSchema,
  RuleSchema,
  addDays,
  createRecord,
  fixedClock,
  toLocalDate,
} from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { reconcileReminderQueue } from '@/features/reminders/reminderService';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/render';

const at = '2026-09-12T09:00:00.000Z';

async function seed() {
  const clock = fixedClock(at);
  const repo = createMemoryRepository({ clock });
  await repo.rules.upsert(
    createRecord(RuleSchema, clock, {
      type: 'reminder',
      name: 'Chase',
      config: { kind: 'followUpAfter', days: 7 },
    }),
  );
  const omar = await repo.people.upsert(
    createRecord(PersonSchema, clock, {
      name: 'Omar',
      contact: 'omar@example.com',
      lastContactAt: '2026-09-01T10:00:00.000Z',
    }),
  );
  const lina = await repo.people.upsert(createRecord(PersonSchema, clock, { name: 'Lina' }));
  const owed = await repo.commitments.upsert(
    createRecord(CommitmentSchema, clock, {
      personId: omar.id,
      text: 'Interview feedback',
      direction: 'owed-to-me',
    }),
  );
  const owed2 = await repo.commitments.upsert(
    createRecord(CommitmentSchema, clock, {
      personId: omar.id,
      text: 'Reference letter',
      direction: 'owed-to-me',
    }),
  );
  const mine = await repo.commitments.upsert(
    createRecord(CommitmentSchema, clock, {
      personId: omar.id,
      text: 'Send CV',
      direction: 'owed-by-me',
      dueAt: '2026-09-01T23:59:00.000Z',
    }),
  );
  await reconcileReminderQueue(repo, clock);
  return { clock, repo, omar, lina, owed, owed2, mine };
}

describe('People pages', () => {
  it('lists people alphabetically with both counts and filters by name', async () => {
    const { repo, clock } = await seed();
    renderWithProviders(<AppRoutes />, { repository: repo, route: '/people', clock });
    const rows = await screen.findAllByTestId('person-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Lina'),
      expect.stringContaining('Omar'),
    ]);
    expect(within(rows[1]!).getByLabelText('You owe 1')).toBeInTheDocument();
    expect(within(rows[1]!).getByLabelText('Owed to you 2')).toBeInTheDocument();
    // Three open commitments: the week-11 badge appears on the same row.
    expect(await within(rows[1]!).findByText('3 open')).toBeInTheDocument();
    expect(within(rows[0]!).queryByText(/open$/)).toBeNull();
    await userEvent.type(screen.getByLabelText('Filter people'), 'lin');
    await waitFor(() => expect(screen.getAllByTestId('person-row')).toHaveLength(1));
  });

  it('adds a person and opens the detail', async () => {
    const { repo, clock } = await seed();
    renderWithProviders(<AppRoutes />, { repository: repo, route: '/people', clock });
    await screen.findAllByTestId('person-row');
    await userEvent.type(screen.getByLabelText('Name'), 'Sara');
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
    await waitFor(() => expect(screen.getAllByTestId('person-row')).toHaveLength(3));
    await userEvent.click(screen.getByRole('link', { name: /Sara/ }));
    expect(await screen.findByRole('button', { name: /^Person name: Sara/ })).toBeInTheDocument();
    expect(screen.getByTestId('last-contact')).toHaveTextContent('never');
  });

  it('records a reply without completing anything and highlights a linked commitment', async () => {
    const { repo, clock, omar, owed, mine } = await seed();
    renderWithProviders(<AppRoutes />, {
      repository: repo,
      route: `/people/${omar.id}?commitment=${owed.id}`,
      clock,
    });
    const rows = await screen.findAllByTestId('commitment-row');
    expect(rows).toHaveLength(3);
    const highlighted = rows.find((r) => r.getAttribute('data-commitment-id') === owed.id)!;
    expect(highlighted).toHaveAttribute('aria-current', 'true');
    expect(within(highlighted).getByTestId('follow-up')).toHaveTextContent(
      'Follow-up counts from 2026-09-12; reminder on 2026-09-19',
    );
    expect(screen.getByTestId('last-contact')).toHaveTextContent('2026-09-01');

    await userEvent.click(screen.getByRole('button', { name: 'Record reply/contact' }));
    const dialog = await screen.findByTestId('contact-dialog');
    expect(dialog).toHaveTextContent('It does not complete any commitment.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record contact' }));
    // The page runs on the system clock: the contact is "now", whatever today is.
    await waitFor(() =>
      expect(screen.getByTestId('last-contact')).not.toHaveTextContent('2026-09-01'),
    );
    const person = (await repo.people.get(omar.id))!;
    expect(Date.now() - new Date(person.lastContactAt!).getTime()).toBeLessThan(120_000);
    // Nothing was completed; the follow-up restarted from the reply.
    expect((await repo.commitments.get(owed.id))!.status).toBe('open');
    expect((await repo.commitments.get(mine.id))!.status).toBe('open');
    const since = toLocalDate(new Date(person.lastContactAt!));
    await waitFor(() =>
      expect(screen.getAllByTestId('follow-up')[0]).toHaveTextContent(
        `Follow-up counts from ${since}; reminder on ${addDays(since, 7)}`,
      ),
    );
  });

  it('marks done, drops, reopens, and adds commitments through separate controls', async () => {
    const { repo, clock, omar, owed } = await seed();
    renderWithProviders(<AppRoutes />, { repository: repo, route: `/people/${omar.id}`, clock });
    const rows = await screen.findAllByTestId('commitment-row');
    const row = rows.find((r) => r.getAttribute('data-commitment-id') === owed.id)!;
    await userEvent.click(within(row).getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(screen.getAllByTestId('commitment-row')).toHaveLength(2));
    expect((await repo.commitments.get(owed.id))!.status).toBe('done');
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'done');
    const doneRow = await screen.findByTestId('commitment-row');
    await userEvent.click(within(doneRow).getByRole('button', { name: 'Reopen' }));
    await waitFor(async () => expect((await repo.commitments.get(owed.id))!.status).toBe('open'));
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'open');
    await waitFor(() => expect(screen.getAllByTestId('commitment-row')).toHaveLength(3));

    await userEvent.type(screen.getByLabelText('Commitment'), 'Share the slides');
    await userEvent.selectOptions(screen.getByLabelText('Direction'), 'owed-to-me');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getAllByTestId('commitment-row')).toHaveLength(4));
    expect(screen.getByLabelText('Commitment')).toHaveValue('');
    // Direction filter narrows the list.
    await userEvent.selectOptions(screen.getByLabelText('Filter by direction'), 'owed-by-me');
    await waitFor(() => expect(screen.getAllByTestId('commitment-row')).toHaveLength(1));
  });

  it('deletes with a confirmation that counts commitments, then restores from the list', async () => {
    const { repo, clock, omar } = await seed();
    renderWithProviders(<AppRoutes />, { repository: repo, route: `/people/${omar.id}`, clock });
    await screen.findAllByTestId('commitment-row');
    await userEvent.click(screen.getByRole('button', { name: 'Delete person' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('3 commitments will be hidden');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete person' }));
    expect(await screen.findByText('Omar was deleted')).toBeInTheDocument();
    expect((await repo.commitments.list()).length).toBe(3);
    await userEvent.click(screen.getByRole('button', { name: 'Restore person' }));
    expect(await screen.findByRole('button', { name: /^Person name: Omar/ })).toBeInTheDocument();
    expect(await screen.findAllByTestId('commitment-row')).toHaveLength(3);
  });

  it('shows a safe state for a missing person', async () => {
    const { repo, clock } = await seed();
    renderWithProviders(<AppRoutes />, {
      repository: repo,
      route: '/people/00000000-0000-7000-8000-000000000001',
      clock,
    });
    expect(await screen.findByText('That person no longer exists')).toBeInTheDocument();
  });
});
