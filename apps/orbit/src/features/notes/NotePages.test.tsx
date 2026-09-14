import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AreaSchema, ProjectSchema, createRecord, fixedClock } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import type { Repository } from '@orbit/storage';
import { useAppStore } from '@/app/store';
import { hasDirtyDrafts } from '@/features/drafts/draftStore';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/render';
import { createNote } from './notesService';

async function seed() {
  const clock = fixedClock(new Date());
  const repo = createMemoryRepository({ clock });
  const area = await repo.areas.upsert(createRecord(AreaSchema, clock, { name: 'Study' }));
  const project = await repo.projects.upsert(
    createRecord(ProjectSchema, clock, { title: 'Thesis', areaId: area.id }),
  );
  const note = await createNote(repo, { title: 'Reading list', body: 'one' }, clock);
  return { clock, repo, area, project, note };
}

describe('Notes pages', () => {
  it('creates a note from the list and opens its editor', async () => {
    const { repo } = await seed();
    renderWithProviders(<AppRoutes />, { repository: repo, route: '/notes' });
    expect(await screen.findAllByTestId('note-row')).toHaveLength(1);
    await userEvent.type(screen.getByLabelText('New note title'), 'Budget');
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByLabelText('Title')).toHaveValue('Budget');
    expect(screen.getByTestId('note-save-state')).toHaveTextContent('Saved');
  });

  it('saves dirty fields on blur and shows Saved only after the commit; reopening shows the text', async () => {
    const { repo, note } = await seed();
    const view = renderWithProviders(<AppRoutes />, {
      repository: repo,
      route: `/notes/${note.id}`,
    });
    const body = await screen.findByLabelText('Body');
    await userEvent.type(body, ' two');
    expect(screen.getByTestId('note-save-state')).toHaveTextContent('Editing');
    expect(hasDirtyDrafts()).toBe(true);
    await userEvent.tab();
    await waitFor(() => expect(screen.getByTestId('note-save-state')).toHaveTextContent('Saved'));
    expect((await repo.notes.get(note.id))!.body).toBe('one two');
    expect(hasDirtyDrafts()).toBe(false);
    view.unmount();
    renderWithProviders(<AppRoutes />, { repository: repo, route: `/notes/${note.id}` });
    expect(await screen.findByLabelText('Body')).toHaveValue('one two');
  });

  it('an empty title never saves and never says Saved', async () => {
    const { repo, note } = await seed();
    renderWithProviders(<AppRoutes />, { repository: repo, route: `/notes/${note.id}` });
    const title = await screen.findByLabelText('Title');
    await userEvent.clear(title);
    expect(screen.getByTestId('note-save-state')).toHaveTextContent('Needs a title');
    await userEvent.tab();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('note-save-state')).not.toHaveTextContent('Saved');
    expect((await repo.notes.get(note.id))!.title).toBe('Reading list');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('a storage failure keeps the text and shows a retry path without a false success or data bump', async () => {
    const { repo, note } = await seed();
    const original = repo.transaction.bind(repo);
    let fail = true;
    const flaky: Repository = {
      ...repo,
      transaction: (fn) => {
        if (fail) return Promise.reject(new Error('The data file is busy.'));
        return original(fn);
      },
    };
    renderWithProviders(<AppRoutes />, { repository: flaky, route: `/notes/${note.id}` });
    const body = await screen.findByLabelText('Body');
    const before = useAppStore.getState().dataVersion;
    await userEvent.type(body, ' more');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('note-failure')).toHaveTextContent('The data file is busy.');
    expect(screen.getByTestId('note-save-state')).toHaveTextContent('Save failed');
    expect(body).toHaveValue('one more');
    expect(useAppStore.getState().dataVersion).toBe(before);
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByTestId('note-save-state')).toHaveTextContent('Saved'));
    expect((await repo.notes.get(note.id))!.body).toBe('one more');
  });

  it('a background refresh never overwrites a dirty draft, and a same-field change elsewhere is a conflict with both texts kept', async () => {
    const { repo, note } = await seed();
    renderWithProviders(<AppRoutes />, { repository: repo, route: `/notes/${note.id}` });
    const body = await screen.findByLabelText('Body');
    await userEvent.type(body, ' mine');
    // Another window edits the same field and announces it.
    await repo.notes.upsert({ ...(await repo.notes.get(note.id))!, body: 'theirs' });
    act(() => useAppStore.getState().bump());
    await new Promise((r) => setTimeout(r, 30));
    expect(body).toHaveValue('one mine');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const conflict = await screen.findByTestId('note-conflict');
    expect(conflict).toHaveTextContent('changed elsewhere (body)');
    expect(screen.getByTestId('note-conflict-current')).toHaveTextContent('theirs');
    expect(body).toHaveValue('one mine');
    expect((await repo.notes.get(note.id))!.body).toBe('theirs');
    // Save as a new note keeps both.
    await userEvent.click(
      within(conflict).getByRole('button', { name: 'Save mine as a new note' }),
    );
    await waitFor(async () => expect(await repo.notes.count()).toBe(2));
    const copy = (await repo.notes.query((n) => n.id !== note.id))[0]!;
    expect(copy.body).toBe('one mine');
    expect(await screen.findByLabelText('Body')).toHaveValue('one mine');
  });

  it('refuses to save into a note deleted elsewhere and offers a new note instead', async () => {
    const { repo, note } = await seed();
    renderWithProviders(<AppRoutes />, { repository: repo, route: `/notes/${note.id}` });
    const body = await screen.findByLabelText('Body');
    await userEvent.type(body, ' late');
    await repo.notes.softDelete(note.id);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('note-gone')).toHaveTextContent('deleted elsewhere');
    expect((await repo.notes.get(note.id))!.deletedAt).not.toBeNull();
    expect(body).toHaveValue('one late');
  });

  it('assigns a project (deriving the area) separately from linking, and blocks archived projects', async () => {
    const { repo, note, project, area } = await seed();
    await repo.projects.upsert(
      createRecord(ProjectSchema, fixedClock(new Date()), {
        title: 'Old',
        areaId: area.id,
        status: 'archived',
      }),
    );
    renderWithProviders(<AppRoutes />, { repository: repo, route: `/notes/${note.id}` });
    const select = await screen.findByLabelText('Project');
    expect(within(select).queryByText(/Old/)).toBeNull();
    await userEvent.selectOptions(select, project.id);
    await waitFor(async () => expect((await repo.notes.get(note.id))!.areaId).toBe(area.id));
    expect(screen.getByLabelText(/^Area/)).toBeDisabled();
    expect(screen.getByText('Thesis', { selector: 'a' })).toHaveAttribute(
      'href',
      `/projects/${project.id}`,
    );
    expect(await repo.links.count()).toBe(0);
  });

  it(
    'renders Markdown safely: no HTML, no image fetches, blocked schemes as text, internal links resolved',
    { timeout: 20_000 },
    async () => {
      const { repo, note } = await seed();
      const other = await createNote(repo, { title: 'Target', body: 'x' }, fixedClock(new Date()));
      const hostile = [
        '# Heading',
        '',
        '- item **bold** and `code`',
        '',
        '> quote',
        '',
        '<script>window.__pwned = 1</script><iframe src="https://evil.example"></iframe>',
        '',
        '![avatar](https://evil.example/track.png)',
        '',
        '[safe](https://example.com/page) [js](javascript:alert(1)) [file](file:///C:/x) [data](data:text/html,hi)',
        '',
        `[open target](orbit://note/${other.id}) [bad](orbit://task/not-a-uuid)`,
        '',
        'a'.repeat(20_000),
      ].join('\n');
      await repo.notes.upsert({ ...note, body: hostile });
      const requests: string[] = [];
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        requests.push(String(input));
        return new Response('');
      });
      renderWithProviders(<AppRoutes />, { repository: repo, route: `/notes/${note.id}` });
      await screen.findByLabelText('Body');
      await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
      const preview = await screen.findByTestId('note-preview');
      await waitFor(() =>
        expect(within(preview).getByRole('heading', { level: 1 })).toHaveTextContent('Heading'),
      );
      expect(preview.querySelector('script')).toBeNull();
      expect(preview.querySelector('iframe')).toBeNull();
      expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
      expect(preview.querySelector('img')).toBeNull();
      expect(within(preview).getByTestId('image-placeholder')).toHaveTextContent('[image: avatar]');
      const safe = within(preview).getByRole('link', { name: 'safe' });
      expect(safe).toHaveAttribute('href', 'https://example.com/page');
      expect(safe).toHaveAttribute('rel', 'noopener noreferrer');
      expect(
        within(preview)
          .getAllByTestId('blocked-link')
          .map((el) => el.textContent),
      ).toEqual(['js', 'file', 'data', 'bad']);
      expect(within(preview).queryByRole('link', { name: 'js' })).toBeNull();
      expect(within(preview).getByText('bold').tagName).toBe('STRONG');
      expect(within(preview).getByText('code').tagName).toBe('CODE');
      expect(preview.querySelector('blockquote')).toHaveTextContent('quote');
      // Viewing the note made no request of any kind.
      expect(requests).toEqual([]);
      fetchSpy.mockRestore();
      // The body was stored losslessly; the preview rewrote nothing.
      expect((await repo.notes.get(note.id))!.body).toBe(hostile);
      // The internal link resolves to the target note through the typed resolver.
      await userEvent.click(within(preview).getByTestId('internal-link'));
      await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Target'));
    },
  );

  it('Save / Discard / Stay guards leaving a note whose blur-save failed', async () => {
    const { repo, note } = await seed();
    // Leaving blurs the editor, which saves; only a failed save leaves the draft dirty.
    const broken: Repository = {
      ...repo,
      transaction: () => Promise.reject(new Error('The data file is busy.')),
    };
    renderWithProviders(<AppRoutes />, { repository: broken, route: `/notes/${note.id}` });
    const body = await screen.findByLabelText('Body');
    await userEvent.type(body, ' unsaved');
    await userEvent.click(screen.getByRole('link', { name: '← Notes' }));
    const guard = await screen.findByTestId('draft-guard');
    expect(guard).toHaveTextContent('Note “Reading list” has unsaved changes');
    await userEvent.click(within(guard).getByRole('button', { name: 'Save' }));
    expect(await within(guard).findByRole('alert')).toHaveTextContent('The data file is busy.');
    expect(screen.getByLabelText('Body')).toHaveValue('one unsaved');
    await userEvent.click(within(guard).getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByTestId('draft-guard')).toBeNull());
    expect(screen.getByLabelText('Body')).toHaveValue('one unsaved');
    await userEvent.click(screen.getByRole('link', { name: '← Notes' }));
    await userEvent.click(
      within(await screen.findByTestId('draft-guard')).getByRole('button', { name: 'Discard' }),
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument());
    expect((await repo.notes.get(note.id))!.body).toBe('one');
  });
});
