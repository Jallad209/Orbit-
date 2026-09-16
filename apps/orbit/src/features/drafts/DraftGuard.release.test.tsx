import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftGuard } from './DraftGuard';
import { useDraftStore } from './draftStore';

/**
 * React Router hands `useBlocker` the same `blocked` object until its own state update
 * (a transition) lands. A draft save writes several synchronous store updates in a row, so
 * the guard re-renders with that stale object; the real router throws if it is released
 * twice. The stub stays `blocked` forever, which is the stale window made permanent.
 */
const stub = vi.hoisted(() => ({
  proceed: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  const blocked = { state: 'blocked', proceed: stub.proceed, reset: stub.reset, location: null };
  return { ...actual, useBlocker: () => blocked };
});

afterEach(() => {
  useDraftStore.setState({ drafts: {}, pending: null });
  vi.clearAllMocks();
});

describe('DraftGuard release', () => {
  it('releases a blocked navigation once, however many store updates re-render it', async () => {
    const { register, update } = useDraftStore.getState();
    act(() => {
      register({
        key: 'note:1',
        label: 'Note “Budget”',
        dirty: true,
        status: 'editing',
        error: null,
        generation: 0,
        flush: async () => ({ ok: true }),
        discard: () => undefined,
      });
    });
    render(<DraftGuard />);
    expect(stub.proceed).not.toHaveBeenCalled();

    // A save lands as a burst of store updates: clean, then the status, then a no-op patch
    // that still produces a new `drafts` object. Each one re-renders the guard.
    act(() => update('note:1', { dirty: false }));
    act(() => update('note:1', { status: 'saved' }));
    act(() => update('note:1', { error: null }));

    expect(stub.proceed).toHaveBeenCalledTimes(1);
  });
});
