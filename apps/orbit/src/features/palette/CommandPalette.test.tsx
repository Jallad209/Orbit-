import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AreaSchema,
  NoteSchema,
  ProjectSchema,
  TaskSchema,
  coreCommands,
  createCommandRegistry,
  createRecord,
  fixedClock,
} from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { createMiniSearchService } from '@orbit/storage/search/minisearch';
import { useToastStore } from '@/components/ui/toastStore';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/render';
import { matchCommands } from './matchCommands';
import { navigationCommands } from './commandRegistry';
import { RECENT_KEY, useCommandPalette } from './useCommandPalette';

const clock = fixedClock(new Date(2026, 8, 14, 10, 0, 0));

async function seeded() {
  const repo = createMemoryRepository({ clock });
  const area = createRecord(AreaSchema, clock, { name: 'University' });
  const project = createRecord(ProjectSchema, clock, { title: 'Thesis', areaId: area.id });
  await repo.areas.upsert(area);
  await repo.projects.upsert(project);
  await repo.notes.upsert(
    createRecord(NoteSchema, clock, {
      title: 'University reading list',
      body: 'Chapters on neural networks.',
      areaId: area.id,
    }),
  );
  await repo.tasks.upsert(
    createRecord(TaskSchema, clock, { title: 'University fees', status: 'open', areaId: area.id }),
  );
  const search = createMiniSearchService({ repo });
  await search.ready();
  return { repo, search, project };
}

function reset() {
  localStorage.clear();
  useCommandPalette.setState({ open: false, recent: [] });
  useToastStore.getState().clear();
}

describe('matchCommands', () => {
  it('ranks "Plan my day" first for "plan" and finds commands by keyword or subsequence', () => {
    const commands = [...coreCommands(), ...navigationCommands()];
    expect(matchCommands(commands, 'plan')[0]?.command.id).toBe('plan-my-day');
    expect(matchCommands(commands, 'rollover')[0]?.command.id).toBe('reschedule-unfinished');
    expect(matchCommands(commands, 'go inbox')[0]?.command.id).toBe('go-inbox');
    expect(matchCommands(commands, 'rgnrt')[0]?.command.id).toBe('regenerate-plan');
    expect(matchCommands(commands, 'zzzz')).toEqual([]);
    // Recent breaks ties between equally good matches.
    const tied = matchCommands(commands, 'add', ['add-note']);
    expect(tied[0]?.command.id).toBe('add-note');
  });
});

describe('CommandPalette', () => {
  beforeEach(reset);

  it('opens with Ctrl+K, closes with Escape, and returns focus to where it was', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/today' });
    await screen.findByRole('heading', { level: 1 });

    const trigger = screen.getByRole('button', { name: 'Search and commands' });
    trigger.focus();
    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox', { name: 'Command or search' });
    expect(input).toHaveFocus();
    expect(screen.getByTestId('command-palette')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());

    // The chord works from inside a text field too.
    await user.click(trigger);
    expect(await screen.findByRole('combobox', { name: 'Command or search' })).toHaveFocus();
  });

  it('lists "Plan my day" first for "plan" and runs it on Enter', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/inbox' });
    await screen.findByRole('heading', { level: 1, name: 'Inbox' });
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('plan');
    const list = screen.getByRole('listbox', { name: 'Commands and results' });
    const options = within(list).getAllByRole('option');
    expect(options[0]).toHaveTextContent('Plan my day');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument());
    expect(
      await screen.findByRole('heading', { level: 1, name: /Today|Tomorrow/ }),
    ).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')).toEqual(['plan-my-day']);
  });

  it('"Add task" prompts for text, validates without losing focus, writes once, and offers Undo', async () => {
    const user = userEvent.setup();
    const { repository } = renderWithProviders(<AppRoutes />, { route: '/inbox' });
    await screen.findByRole('heading', { level: 1, name: 'Inbox' });
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('add task{Enter}');

    const field = await screen.findByLabelText('What needs doing?');
    expect(field).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Type something first.');
    expect(field).toHaveFocus();
    expect(await repository.tasks.count()).toBe(0);

    await user.keyboard('Water the plants{Enter}');
    await waitFor(() => expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument());
    await waitFor(async () => expect(await repository.tasks.count()).toBe(1));
    expect((await repository.tasks.list())[0]?.title).toBe('Water the plants');

    // The toaster lives in App.tsx; the store shows what was pushed.
    const toasts = () => useToastStore.getState().toasts;
    await waitFor(() => expect(toasts().at(-1)?.title).toBe('Added task'));
    expect(toasts().at(-1)?.action?.label).toBe('Undo');
    toasts().at(-1)!.action!.onClick();
    await waitFor(async () => expect(await repository.tasks.count()).toBe(0));
    await waitFor(() => expect(toasts().at(-1)?.title).toBe('Undid: Add task'));
  });

  it('Escape inside a prompt steps back to the list instead of closing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/inbox' });
    await screen.findByRole('heading', { level: 1, name: 'Inbox' });
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('add note{Enter}');
    await screen.findByLabelText('Note title');
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('combobox', { name: 'Command or search' })).toBeInTheDocument();
    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
  });

  it('shows search results with type chips, honours type:note, and opens a hit', async () => {
    const user = userEvent.setup();
    const { repo, search } = await seeded();
    renderWithProviders(<AppRoutes />, { route: '/inbox', repository: repo, search });
    await screen.findByRole('heading', { level: 1, name: 'Inbox' });
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('univ');

    const results = await screen.findByRole('group', { name: 'Results' });
    await waitFor(() => expect(within(results).getAllByRole('option').length).toBe(3));
    const kinds = within(results)
      .getAllByRole('option')
      .map((o) => o.querySelector('[data-kind]')?.getAttribute('data-kind'));
    // Title matches (task, note) before the project matched on its area name.
    expect(kinds.slice(0, 2).sort()).toEqual(['note', 'task']);
    expect(kinds[2]).toBe('project');
    expect(within(results).getAllByText('Univ', { selector: 'mark' }).length).toBeGreaterThan(0);

    await user.clear(screen.getByRole('combobox', { name: 'Command or search' }));
    await user.keyboard('type:note univ');
    await waitFor(() => {
      const rows = within(screen.getByRole('group', { name: 'Results' })).getAllByRole('option');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveTextContent('University reading list');
    });

    // Enter on the (first and only) hit opens it in the search preview.
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument());
    // The preview drawer is modal, so the page behind it is aria-hidden while it is open.
    expect(await screen.findByTestId('search-preview')).toHaveTextContent(
      'University reading list',
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Search', hidden: true }),
    ).toBeInTheDocument();
  });

  it('remembers recent commands, capped, and lists them first when the box is empty', async () => {
    const user = userEvent.setup();
    const registry = createCommandRegistry({
      commands: [...coreCommands(), ...navigationCommands()],
    });
    renderWithProviders(<AppRoutes />, { route: '/inbox', commands: registry });
    await screen.findByRole('heading', { level: 1, name: 'Inbox' });
    for (const word of ['go to projects', 'go to inbox']) {
      await user.keyboard('{Control>}k{/Control}');
      await user.keyboard(`${word}{Enter}`);
      await waitFor(() => expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument());
    }
    await user.keyboard('{Control>}k{/Control}');
    const recent = await screen.findByRole('group', { name: 'Recent' });
    const labels = within(recent)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels[0]).toContain('Go to Inbox');
    expect(labels[1]).toContain('Go to Projects');
    expect(useCommandPalette.getState().recent).toEqual(['go-inbox', 'go-projects']);
    for (let i = 0; i < 15; i += 1) useCommandPalette.getState().markRecent(`cmd-${i}`);
    expect(useCommandPalette.getState().recent).toHaveLength(10);
  });
});
