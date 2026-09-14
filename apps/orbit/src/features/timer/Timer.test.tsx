import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionSchema, TaskSchema, createRecord, fixedClock } from '@orbit/core';
import type { Clock, Id } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { renderWithProviders } from '@/test/render';
import { formatElapsed } from './timerService';
import { useTimer } from './useTimer';

const NOW = new Date(2026, 8, 14, 10, 0, 0);

function Harness({ clock, taskId }: { clock: Clock; taskId: Id }) {
  const t = useTimer(clock);
  return (
    <div>
      <output data-testid="elapsed">{t.elapsed}</output>
      <span data-testid="task">{t.active?.task?.title ?? '—'}</span>
      <span data-testid="loading">{String(t.loading)}</span>
      <button onClick={() => void t.start(taskId)}>start</button>
      <button onClick={() => void t.stop()}>stop</button>
    </div>
  );
}

async function seed(clock: Clock) {
  const repo = createMemoryRepository({ clock });
  const intro = createRecord(TaskSchema, clock, { title: 'Write intro', status: 'open' });
  const cards = createRecord(TaskSchema, clock, { title: 'Flash cards', status: 'open' });
  await repo.tasks.upsert(intro);
  await repo.tasks.upsert(cards);
  return { repo, intro, cards };
}

describe('formatElapsed', () => {
  it('renders m:ss, and h:mm:ss past an hour', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65)).toBe('1:05');
    expect(formatElapsed(25 * 60 + 13)).toBe('25:13');
    expect(formatElapsed(3600 + 5 * 60 + 13)).toBe('1:05:13');
    expect(formatElapsed(-4)).toBe('0:00');
  });
});

describe('useTimer', () => {
  beforeEach(() => {
    document.title = 'Orbit';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('restores the running session from the repository on mount and titles the window', async () => {
    const clock = fixedClock(NOW);
    const { repo, intro } = await seed(clock);
    // Started 25:13 ago, never stopped: what a restart leaves behind.
    const startAt = new Date(NOW.getTime() - (25 * 60 + 13) * 1000).toISOString();
    await repo.sessions.upsert(
      createRecord(SessionSchema, clock, { taskId: intro.id, startAt, endAt: null }),
    );
    const view = renderWithProviders(<Harness clock={clock} taskId={intro.id} />, {
      repository: repo,
    });
    await waitFor(() => expect(screen.getByTestId('task')).toHaveTextContent('Write intro'));
    expect(screen.getByTestId('elapsed')).toHaveTextContent('25:13');
    expect(document.title).toBe('25:13 · Write intro');

    view.unmount();
    expect(document.title).toBe('Orbit');
  });

  it('ticks once a second from the wall clock and stops cleanly', async () => {
    vi.useFakeTimers();
    const clock = fixedClock(NOW);
    const { repo, intro } = await seed(clock);
    await repo.sessions.upsert(
      createRecord(SessionSchema, clock, {
        taskId: intro.id,
        startAt: NOW.toISOString(),
        endAt: null,
      }),
    );
    // No search or insights provider: their refresh timers would show up in the timer count below.
    renderWithProviders(<Harness clock={clock} taskId={intro.id} />, {
      repository: repo,
      search: false,
      insights: false,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('elapsed')).toHaveTextContent('0:00');
    await act(async () => {
      clock.advance(3000);
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId('elapsed')).toHaveTextContent('0:03');
    expect(document.title).toBe('0:03 · Write intro');
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      screen.getByRole('button', { name: 'stop' }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('task')).toHaveTextContent('—');
    expect(screen.getByTestId('elapsed')).toHaveTextContent('0:00');
    expect(document.title).toBe('Orbit');
    expect(vi.getTimerCount()).toBe(0);
    const stored = (await repo.sessions.list())[0]!;
    expect(stored.endAt).toBe(new Date(NOW.getTime() + 3000).toISOString());
  });

  it('starting on another task closes the running session first', async () => {
    const user = userEvent.setup();
    const clock = fixedClock(NOW);
    const { repo, intro, cards } = await seed(clock);
    await repo.sessions.upsert(
      createRecord(SessionSchema, clock, {
        taskId: cards.id,
        startAt: new Date(NOW.getTime() - 60_000).toISOString(),
        endAt: null,
      }),
    );
    renderWithProviders(<Harness clock={clock} taskId={intro.id} />, { repository: repo });
    await waitFor(() => expect(screen.getByTestId('task')).toHaveTextContent('Flash cards'));
    await user.click(screen.getByRole('button', { name: 'start' }));
    await waitFor(() => expect(screen.getByTestId('task')).toHaveTextContent('Write intro'));
    const sessions = await repo.sessions.list();
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.endAt === null).map((s) => s.taskId)).toEqual([intro.id]);
    expect(sessions.find((s) => s.taskId === cards.id)?.endAt).toBe(NOW.toISOString());
  });
});
