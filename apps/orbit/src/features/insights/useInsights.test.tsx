import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import {
  PersonSchema,
  CommitmentSchema,
  ProjectSchema,
  createRecord,
  fixedClock,
} from '@orbit/core';
import type { Clock } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import type { Repository } from '@orbit/storage';
import { useAppStore } from '@/app/store';
import * as service from './insightService';
import { REFRESH_DEBOUNCE_MS, useInsightsEngine } from './useInsights';

const NOW = new Date(2026, 8, 14, 10, 0, 0);
const DAY_MS = 86_400_000;

function Harness({ repo, clock }: { repo: Repository; clock: Clock }) {
  const { view, loading, error, stale } = useInsightsEngine(repo, clock);
  return (
    <div>
      <output data-testid="keys">
        {view ? view.active.map((i) => i.key).join(',') : '(none)'}
      </output>
      <output data-testid="seq">{view?.opLogSeq ?? -1}</output>
      <output data-testid="flags">
        {[loading && 'loading', error && 'error', stale && 'stale'].filter(Boolean).join(' ')}
      </output>
    </div>
  );
}

async function withPerson(repo: Repository, clock: Clock, name: string, open = 3) {
  const person = createRecord(PersonSchema, clock, { name });
  await repo.people.upsert(person);
  for (let i = 0; i < open; i += 1) {
    await repo.commitments.upsert(
      createRecord(CommitmentSchema, clock, { personId: person.id, text: `${name} ${i}` }),
    );
  }
  return person;
}

describe('useInsightsEngine', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({ dataVersion: 0 });
  });

  it('computes once per data generation: debounced after writes, not per render', async () => {
    const clock = fixedClock(NOW);
    const repo = createMemoryRepository({ clock });
    const spy = vi.spyOn(service, 'loadInsightView');
    const { rerender } = render(<Harness repo={repo} clock={clock} />);
    await waitFor(() => expect(screen.getByTestId('keys')).toHaveTextContent('(none)'));
    expect(spy).toHaveBeenCalledTimes(1);
    rerender(<Harness repo={repo} clock={clock} />);
    rerender(<Harness repo={repo} clock={clock} />);
    expect(spy).toHaveBeenCalledTimes(1);

    const sara = await withPerson(repo, clock, 'Sara');
    act(() => {
      useAppStore.getState().bump();
      useAppStore.getState().bump();
      useAppStore.getState().bump();
    });
    await waitFor(
      () => expect(screen.getByTestId('keys')).toHaveTextContent(`person-commitments:${sara.id}`),
      {
        timeout: REFRESH_DEBOUNCE_MS + 1000,
      },
    );
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('picks up another window’s commit on focus through the op-log head, and stays quiet otherwise', async () => {
    const clock = fixedClock(NOW);
    const repo = createMemoryRepository({ clock });
    const spy = vi.spyOn(service, 'loadInsightView');
    render(<Harness repo={repo} clock={clock} />);
    await waitFor(() => expect(screen.getByTestId('seq')).toHaveTextContent('0'));
    // Focus without any change: no recompute.
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledTimes(1);
    // "Another window" writes straight to the repository, without bumping this window's store.
    const omar = await withPerson(repo, clock, 'Omar');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('keys')).toHaveTextContent(`person-commitments:${omar.id}`),
    );
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('drops a result from a repository that was replaced while it was loading', async () => {
    const clock = fixedClock(NOW);
    const slow = createMemoryRepository({ clock });
    await withPerson(slow, clock, 'Slow');
    const fast = createMemoryRepository({ clock });
    const gate = { release: () => {} };
    const original = service.loadInsightView;
    vi.spyOn(service, 'loadInsightView').mockImplementation(async (repo, c) => {
      if (repo === slow) await new Promise<void>((r) => (gate.release = r));
      return original(repo, c);
    });
    const { rerender } = render(<Harness repo={slow} clock={clock} />);
    await new Promise((r) => setTimeout(r, 10));
    rerender(<Harness repo={fast} clock={clock} />);
    await waitFor(() => expect(screen.getByTestId('keys')).toHaveTextContent('(none)'));
    await act(async () => {
      gate.release();
      await new Promise((r) => setTimeout(r, 10));
    });
    // The old repository's answer (a person insight) never landed; the fast one (nothing) did.
    expect(screen.getByTestId('keys')).not.toHaveTextContent('person-commitments');
    expect(screen.getByTestId('flags')).toHaveTextContent('');
  });

  it('keeps the last view and flags it stale when a refresh fails', async () => {
    const clock = fixedClock(NOW);
    const repo = createMemoryRepository({ clock });
    const sara = await withPerson(repo, clock, 'Sara');
    render(<Harness repo={repo} clock={clock} />);
    await waitFor(() => expect(screen.getByTestId('keys')).toHaveTextContent(sara.id));
    vi.spyOn(service, 'loadInsightView').mockRejectedValueOnce(new Error('disk gone'));
    act(() => useAppStore.getState().bump());
    await waitFor(() => expect(screen.getByTestId('flags')).toHaveTextContent('error stale'));
    expect(screen.getByTestId('keys')).toHaveTextContent(sara.id);
  });

  it('schedules one recompute at the next time boundary', async () => {
    vi.useFakeTimers();
    try {
      const clock = fixedClock(NOW);
      const repo = createMemoryRepository({ clock });
      // A project that becomes stale in exactly one hour.
      const old = fixedClock(new Date(NOW.getTime() - 10 * DAY_MS + 3_600_000));
      const project = createRecord(ProjectSchema, old, {
        title: 'Soon stale',
        areaId: '019372a0-0000-7000-8000-000000000001',
      });
      await repo.projects.upsert(project, { preserveUpdatedAt: true });
      const spy = vi.spyOn(service, 'loadInsightView');
      render(<Harness repo={repo} clock={clock} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByTestId('keys')).not.toHaveTextContent('stale-project');
      expect(spy).toHaveBeenCalledTimes(1);
      await act(async () => {
        clock.advance(3_599_000);
        await vi.advanceTimersByTimeAsync(3_599_000);
      });
      expect(spy).toHaveBeenCalledTimes(1);
      await act(async () => {
        clock.advance(1000);
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(spy).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('keys')).toHaveTextContent(`stale-project:${project.id}`);
    } finally {
      vi.useRealTimers();
    }
  });
});
