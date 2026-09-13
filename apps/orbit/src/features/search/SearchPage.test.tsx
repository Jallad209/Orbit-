import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AreaSchema,
  CommitmentSchema,
  NoteSchema,
  PersonSchema,
  ProjectSchema,
  TaskSchema,
  createRecord,
  fixedClock,
} from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { createMiniSearchService } from '@orbit/storage/search/minisearch';
import { useToastStore } from '@/components/ui/toastStore';
import { usePlanPrefs } from '@/features/today/planSettings';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/render';
import { parsePreviewRef } from './searchActions';
import { SearchPage } from './SearchPage';

// Monday 14 Sep 2026, 10:00 local.
const clock = fixedClock(new Date(2026, 8, 14, 10, 0, 0));

async function seeded() {
  const repo = createMemoryRepository({ clock });
  const university = createRecord(AreaSchema, clock, { name: 'University' });
  const home = createRecord(AreaSchema, clock, { name: 'Home' });
  const thesis = createRecord(ProjectSchema, clock, { title: 'Thesis', areaId: university.id });
  const note = createRecord(NoteSchema, clock, {
    title: 'University reading list',
    body: 'Chapters on neural networks.\nMeet Omar about the lab.',
    projectId: thesis.id,
    areaId: university.id,
  });
  const fees = createRecord(TaskSchema, clock, {
    title: 'University fees',
    status: 'open',
    projectId: thesis.id,
    areaId: university.id,
    estimateMin: 30,
  });
  const chores = createRecord(TaskSchema, clock, {
    title: 'University parking permit',
    status: 'open',
    areaId: home.id,
  });
  const omar = createRecord(PersonSchema, clock, {
    name: 'Omar Haddad',
    contact: 'omar@example.com',
  });
  const commitment = createRecord(CommitmentSchema, clock, {
    personId: omar.id,
    text: 'Send the lab draft',
    direction: 'owed-to-me',
  });
  await repo.areas.upsert(university);
  await repo.areas.upsert(home);
  await repo.projects.upsert(thesis);
  await repo.notes.upsert(note);
  await repo.tasks.upsert(fees);
  await repo.tasks.upsert(chores);
  await repo.people.upsert(omar);
  await repo.commitments.upsert(commitment);
  const search = createMiniSearchService({ repo });
  await search.ready();
  return { repo, search, university, home, thesis, note, fees, chores, omar };
}

describe('SearchPage', () => {
  beforeEach(() => {
    useToastStore.getState().clear();
    usePlanPrefs.setState({ workingWindow: { startMin: 540, endMin: 1080 }, restBoundaries: [] });
  });

  it('reads the query from the URL, shows chips and highlights, and filters with type:note', async () => {
    const user = userEvent.setup();
    const { repo, search } = await seeded();
    renderWithProviders(<AppRoutes />, { route: '/search?q=univ', repository: repo, search });
    expect(await screen.findByRole('heading', { level: 1, name: 'Search' })).toBeInTheDocument();
    const input = screen.getByRole('searchbox', { name: 'Search' });
    expect(input).toHaveValue('univ');

    const list = await screen.findByRole('list', { name: 'Search results' });
    await waitFor(() => expect(within(list).getAllByTestId('search-hit')).toHaveLength(4));
    const types = within(list)
      .getAllByTestId('search-hit')
      .map((li) => li.getAttribute('data-type'));
    expect(types.slice(0, 3).sort()).toEqual(['note', 'task', 'task']);
    expect(types[3]).toBe('project');
    expect(within(list).getAllByText('Univ', { selector: 'mark' }).length).toBeGreaterThan(0);

    // The type checkbox edits the same query string the user types into.
    await user.click(screen.getByRole('checkbox', { name: 'Notes' }));
    await waitFor(() => expect(input).toHaveValue('type:note univ'));
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Search results' })).getAllByTestId('search-hit'),
      ).toHaveLength(1),
    );
    expect(screen.getByTestId('search-hit')).toHaveAttribute('data-type', 'note');
    expect(screen.getByRole('checkbox', { name: 'Notes' })).toBeChecked();
  });

  it('area filter and malformed filters are reflected in the URL and reported', async () => {
    const user = userEvent.setup();
    const { repo, search, home } = await seeded();
    renderWithProviders(<AppRoutes />, { route: '/search?q=univ', repository: repo, search });
    const input = await screen.findByRole('searchbox', { name: 'Search' });
    await user.selectOptions(await screen.findByLabelText('Area'), home.id);
    await waitFor(() => expect(input).toHaveValue('area:Home univ'));
    await waitFor(() => expect(screen.getAllByTestId('search-hit')).toHaveLength(1));
    expect(screen.getByTestId('search-hit')).toHaveTextContent('University parking permit');

    await user.clear(input);
    await user.type(input, 'type:banana univ');
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown type "banana"');
    await waitFor(() => expect(screen.getAllByTestId('search-hit').length).toBeGreaterThan(1));
  });

  it('previews a note and a person without leaving the page, and moves with the arrow keys', async () => {
    const user = userEvent.setup();
    const { repo, search, note } = await seeded();
    renderWithProviders(<AppRoutes />, { route: `/search?q=omar`, repository: repo, search });
    const list = await screen.findByRole('list', { name: 'Search results' });
    await waitFor(() => expect(within(list).getAllByTestId('search-hit')).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Preview: Omar Haddad' }));
    const preview = await screen.findByTestId('search-preview');
    expect(preview).toHaveTextContent('omar@example.com');
    expect(preview).toHaveTextContent('Send the lab draft');
    expect(preview).toHaveTextContent('they owe');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('search-preview')).not.toBeInTheDocument());

    // Arrow keys move between rows; Enter previews the note.
    const rows = within(list).getAllByRole('button', { name: /^Preview / });
    rows[0]!.focus();
    await user.keyboard('{ArrowDown}');
    expect(rows[1]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(rows[0]).toHaveFocus();
    const noteRow = within(list).getByRole('button', { name: 'Preview University reading list' });
    noteRow.focus();
    await user.keyboard('{Enter}');
    const notePreview = await screen.findByTestId('search-preview');
    expect(within(notePreview).getByTestId('note-body')).toHaveTextContent(
      'Meet Omar about the lab.',
    );
    expect(parsePreviewRef(`note:${note.id}`)).toEqual({ type: 'note', id: note.id });
  });

  it('completes and schedules a task from its quick actions', async () => {
    const user = userEvent.setup();
    const { repo, search, fees, chores } = await seeded();
    // The page's own clock: scheduling looks for a slot after "now" (10:00 here).
    renderWithProviders(<SearchPage clock={clock} />, {
      route: '/search?q=type:task univ',
      repository: repo,
      search,
    });
    await waitFor(() => expect(screen.getAllByTestId('search-hit')).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: `Complete: ${fees.title}` }));
    await waitFor(async () => expect((await repo.tasks.get(fees.id))?.status).toBe('done'));
    expect(useToastStore.getState().toasts.at(-1)?.title).toBe('Task completed');

    await user.click(screen.getByRole('button', { name: `Schedule today: ${chores.title}` }));
    await waitFor(async () => {
      const blocks = await repo.blocks.query((b) => b.taskId === chores.id);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.date).toBe('2026-09-14');
    });
    expect(useToastStore.getState().toasts.at(-1)?.title).toBe('Scheduled today');
  });

  it('shows a prompt without a query, and opens a project directly', async () => {
    const user = userEvent.setup();
    const { repo, search, thesis } = await seeded();
    renderWithProviders(<AppRoutes />, { route: '/search', repository: repo, search });
    expect(await screen.findByTestId('search-prompt')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'thesis');
    const open = await screen.findByRole('button', { name: `Open: ${thesis.title}` });
    await user.click(open);
    expect(await screen.findByRole('heading', { level: 1, name: 'Thesis' })).toBeInTheDocument();
  });
});
