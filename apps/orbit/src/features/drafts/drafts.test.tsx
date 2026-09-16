import { useState } from 'react';
import { Link, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { useDraftRegistration } from './DraftGuard';
import {
  confirmLeave,
  dirtyDrafts,
  flushDrafts,
  hasDirtyDrafts,
  useDraftStore,
} from './draftStore';

interface EditorProps {
  label?: string;
  flush?: () => Promise<{ ok: true } | { ok: false; reason: string }>;
  invalid?: boolean;
}

/** A minimal editor: typing makes it dirty, "save" resolves through the registered flush. */
function Editor({ label = 'Note “Budget”', flush, invalid = false }: EditorProps) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const dirty = text !== saved;
  useDraftRegistration({
    key: 'note:1',
    label,
    dirty,
    status: invalid && dirty ? 'invalid' : dirty ? 'editing' : 'saved',
    error: invalid && dirty ? 'A title is required.' : null,
    flush: async () => {
      const result = flush ? await flush() : { ok: true as const };
      if (result.ok) setSaved(text);
      return result;
    },
    discard: () => setText(saved),
  });
  return (
    <div>
      <input aria-label="Body" value={text} onChange={(e) => setText(e.target.value)} />
      <span data-testid="dirty">{dirty ? 'dirty' : 'clean'}</span>
    </div>
  );
}

function App(props: EditorProps) {
  return (
    <Routes>
      <Route
        path="/notes/1"
        element={
          <>
            <Editor {...props} />
            <Link to="/today">Today</Link>
          </>
        }
      />
      <Route path="/today" element={<h1>Today</h1>} />
    </Routes>
  );
}

afterEach(() => {
  useDraftStore.setState({ drafts: {}, pending: null });
  vi.restoreAllMocks();
});

describe('draft coordinator', () => {
  it('registers dirty state and unregisters on unmount', async () => {
    const view = renderWithProviders(<App />, {
      route: '/notes/1',
      insights: false,
      search: false,
    });
    expect(hasDirtyDrafts()).toBe(false);
    await userEvent.type(screen.getByLabelText('Body'), 'hello');
    await waitFor(() => expect(hasDirtyDrafts()).toBe(true));
    expect(dirtyDrafts().map((d) => d.label)).toEqual(['Note “Budget”']);
    view.unmount();
    expect(hasDirtyDrafts()).toBe(false);
  });

  it('blocks navigation with Save / Discard / Stay and saves before proceeding', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const flush = vi.fn(async () => ({ ok: true as const }));
    renderWithProviders(<App flush={flush} />, {
      route: '/notes/1',
      insights: false,
      search: false,
    });
    await userEvent.type(screen.getByLabelText('Body'), 'hello');
    await userEvent.click(screen.getByRole('link', { name: 'Today' }));
    const dialog = await screen.findByTestId('draft-guard');
    expect(dialog).toHaveTextContent('Note “Budget” has unsaved changes');
    expect(screen.queryByRole('heading', { name: 'Today' })).toBeNull();
    // Stay keeps the editor and its text.
    await userEvent.click(screen.getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByTestId('draft-guard')).toBeNull());
    expect(screen.getByLabelText('Body')).toHaveValue('hello');
    // Save flushes, then proceeds.
    await userEvent.click(screen.getByRole('link', { name: 'Today' }));
    await screen.findByTestId('draft-guard');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'Today' });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(hasDirtyDrafts()).toBe(false);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('keeps the draft and shows the reason when the save fails; Discard proceeds without saving', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const flush = vi.fn(async () => ({ ok: false as const, reason: 'The data file is busy.' }));
    renderWithProviders(<App flush={flush} />, {
      route: '/notes/1',
      insights: false,
      search: false,
    });
    await userEvent.type(screen.getByLabelText('Body'), 'hello');
    await userEvent.click(screen.getByRole('link', { name: 'Today' }));
    await screen.findByTestId('draft-guard');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The data file is busy.');
    expect(screen.queryByRole('heading', { name: 'Today' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await screen.findByRole('heading', { name: 'Today' });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('an invalid draft cannot be saved by the guard: the reason is shown and nothing is written', async () => {
    const flush = vi.fn(async () => ({ ok: true as const }));
    renderWithProviders(<App flush={flush} invalid />, {
      route: '/notes/1',
      insights: false,
      search: false,
    });
    await userEvent.type(screen.getByLabelText('Body'), 'x');
    await userEvent.click(screen.getByRole('link', { name: 'Today' }));
    await screen.findByTestId('draft-guard');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A title is required.');
    expect(flush).not.toHaveBeenCalled();
  });

  it('confirmLeave asks through the same dialog for imperative exits and reports the outcome', async () => {
    const flush = vi.fn(async () => ({ ok: true as const }));
    renderWithProviders(<App flush={flush} />, {
      route: '/notes/1',
      insights: false,
      search: false,
    });
    expect(await confirmLeave('reload Orbit')).toBe(true);
    await userEvent.type(screen.getByLabelText('Body'), 'hello');
    let outcome: Promise<boolean>;
    await act(async () => {
      outcome = confirmLeave('reload Orbit');
    });
    const dialog = await screen.findByTestId('draft-guard');
    expect(dialog).toHaveTextContent('before you reload Orbit');
    await userEvent.click(screen.getByRole('button', { name: 'Stay' }));
    let answer: boolean | undefined;
    await act(async () => {
      answer = await outcome!;
    });
    expect(answer).toBe(false);
    await act(async () => {
      outcome = confirmLeave('reload Orbit');
    });
    await screen.findByTestId('draft-guard');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await act(async () => {
      answer = await outcome!;
    });
    expect(answer).toBe(true);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('flushDrafts stops at the first failure and a restore invalidates older generations', async () => {
    const store = useDraftStore.getState();
    const first = vi.fn(async () => ({ ok: false as const, reason: 'nope' }));
    const second = vi.fn(async () => ({ ok: true as const }));
    store.register({
      key: 'a',
      label: 'A',
      dirty: true,
      status: 'editing',
      error: null,
      generation: 1,
      flush: first,
      discard: () => {},
    });
    store.register({
      key: 'b',
      label: 'B',
      dirty: true,
      status: 'editing',
      error: null,
      generation: 2,
      flush: second,
      discard: () => {},
    });
    expect(await flushDrafts()).toEqual({ ok: false, reason: 'A: nope' });
    expect(second).not.toHaveBeenCalled();
    store.invalidate(2);
    expect(dirtyDrafts().map((d) => d.key)).toEqual(['b']);
  });
});
