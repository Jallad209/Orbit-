import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AreaSchema, ProjectSchema, createRecord, fixedClock, parseCapture } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import type { Repository } from '@orbit/storage';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/render';
import { InboxPage } from './InboxPage';
import { saveCapture } from './inboxService';

const clock = fixedClock(new Date(2026, 8, 12, 9, 0, 0));
const ctx = { now: clock.now() };

async function seed(): Promise<Repository> {
  const repo = createMemoryRepository({ clock });
  await saveCapture(repo, parseCapture('Submit my report next Friday', ctx), clock);
  clock.advance(1000);
  await saveCapture(repo, parseCapture('Idea: an app that plans your day', ctx), clock);
  clock.advance(1000);
  await saveCapture(repo, parseCapture('Buy milk', ctx), clock);
  return repo;
}

describe('InboxPage', () => {
  it('groups captures by type and moves the selection with j / k', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InboxPage clock={clock} />, { repository: await seed(), route: '/inbox' });

    const tasks = await screen.findByRole('group', { name: 'Tasks' });
    const notes = screen.getByRole('group', { name: 'Notes' });
    expect(within(tasks).getAllByRole('option')).toHaveLength(2);
    expect(within(notes).getAllByRole('option')).toHaveLength(1);

    // Newest first within a group.
    const [first, second] = within(tasks).getAllByRole('option');
    expect(first).toHaveTextContent('Buy milk');
    expect(second).toHaveTextContent('Submit my report');

    await user.click(first!);
    expect(first).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('j');
    expect(second).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('j');
    expect(within(notes).getByRole('option')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('k');
    expect(second).toHaveAttribute('aria-selected', 'true');
  });

  it('p opens project assignment; choosing a project converts the capture and removes it', async () => {
    const user = userEvent.setup();
    const repo = await seed();
    const area = createRecord(AreaSchema, clock, { name: 'Study' });
    const project = createRecord(ProjectSchema, clock, { title: 'Thesis', areaId: area.id });
    await repo.areas.upsert(area);
    await repo.projects.upsert(project);
    renderWithProviders(<InboxPage clock={clock} />, { repository: repo, route: '/inbox' });

    const row = await screen.findByRole('option', { name: /Submit my report/ });
    await user.click(row);
    await user.keyboard('p');
    const popover = await screen.findByRole('dialog', { name: 'Assign project' });
    await user.click(within(popover).getByRole('button', { name: 'Thesis' }));

    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Submit my report/ })).not.toBeInTheDocument(),
    );
    const tasks = await repo.tasks.list();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.projectId).toBe(project.id);
    expect(tasks[0]?.status).toBe('open');
    const processed = (await repo.captures.list()).find((c) => c.status === 'processed');
    expect(processed?.processedId).toBe(tasks[0]?.id);
  });

  it('e archives the selected capture', async () => {
    const user = userEvent.setup();
    const repo = await seed();
    renderWithProviders(<InboxPage clock={clock} />, { repository: repo, route: '/inbox' });
    const row = await screen.findByRole('option', { name: /Buy milk/ });
    await user.click(row);
    await user.keyboard('e');
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Buy milk/ })).not.toBeInTheDocument(),
    );
    expect((await repo.captures.list()).find((c) => c.text === 'Buy milk')?.status).toBe(
      'archived',
    );
  });

  it('Enter accepts the selected capture as its type', async () => {
    const user = userEvent.setup();
    const repo = await seed();
    renderWithProviders(<InboxPage clock={clock} />, { repository: repo, route: '/inbox' });
    const row = await screen.findByRole('option', { name: /an app that plans/i });
    await user.click(row);
    await user.keyboard('{Enter}');
    await waitFor(async () => expect(await repo.notes.count()).toBe(1));
    expect(screen.queryByRole('option', { name: /an app that plans/i })).not.toBeInTheDocument();
  });

  it('t cycles the type of the selected capture', async () => {
    const user = userEvent.setup();
    const repo = await seed();
    renderWithProviders(<InboxPage clock={clock} />, { repository: repo, route: '/inbox' });
    await user.click(await screen.findByRole('option', { name: /Buy milk/ }));
    await user.keyboard('t');
    await waitFor(async () =>
      expect((await repo.captures.list()).find((c) => c.text === 'Buy milk')?.type).toBe('event'),
    );
    expect(await screen.findByRole('group', { name: 'Events' })).toBeInTheDocument();
  });

  it('a capture typed into the bar appears in the list', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InboxPage clock={clock} />, { route: '/inbox' });
    expect(await screen.findByText('Inbox zero')).toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', { name: 'Capture' }),
      'Call Ahmed back tomorrow{Enter}',
    );
    expect(await screen.findByRole('option', { name: /Call Ahmed back/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Commitments' })).toBeInTheDocument();
    expect(screen.queryByText('Inbox zero')).not.toBeInTheDocument();
  });
});

describe('Quick capture overlay', () => {
  it('c opens the overlay from any screen with the input focused, and Escape closes it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/today' });
    await user.keyboard('c');
    const overlay = await screen.findByTestId('quick-capture');
    const input = within(overlay).getByRole('textbox', { name: 'Capture' });
    await waitFor(() => expect(input).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('quick-capture')).not.toBeInTheDocument());
  });

  it('does not open while typing in a text field', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/inbox' });
    await user.click(await screen.findByRole('textbox', { name: 'Capture' }));
    await user.keyboard('c');
    expect(screen.queryByTestId('quick-capture')).not.toBeInTheDocument();
  });
});
