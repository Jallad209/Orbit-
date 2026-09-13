import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionSchema, TaskSchema, createRecord, fixedClock } from '@orbit/core';
import type { Task } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { useState } from 'react';
import { useToastStore } from '@/components/ui/toastStore';
import { renderWithProviders } from '@/test/render';
import { CompleteTaskDialog } from './CompleteTaskDialog';

const clock = fixedClock(new Date(2026, 8, 14, 16, 0, 0));

function Harness({ task }: { task: Task }) {
  const [completing, setCompleting] = useState<Task | null>(null);
  const [closed, setClosed] = useState(0);
  return (
    <div>
      <button onClick={() => setCompleting(task)}>Done</button>
      <span data-testid="closed">{closed}</span>
      <CompleteTaskDialog
        task={completing}
        onClose={() => {
          setCompleting(null);
          setClosed((n) => n + 1);
        }}
        clock={clock}
      />
    </div>
  );
}

async function seed(estimateMin = 90) {
  const repo = createMemoryRepository({ clock });
  const task = createRecord(TaskSchema, clock, {
    title: 'Write intro',
    status: 'open',
    estimateMin,
  });
  await repo.tasks.upsert(task);
  return { repo, task };
}

describe('CompleteTaskDialog', () => {
  beforeEach(() => useToastStore.getState().clear());

  it('prefills the estimate and accepts a duration like 1h30', async () => {
    const user = userEvent.setup();
    const { repo, task } = await seed(90);
    renderWithProviders(<Harness task={task} />, { repository: repo });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    const dialog = await screen.findByTestId('complete-dialog');
    const input = screen.getByRole('textbox', { name: 'Actual time' });
    expect(input).toHaveValue('1h 30m');
    expect(dialog).toHaveTextContent('estimated 1h 30m');

    await user.clear(input);
    await user.type(input, '1h30{Enter}');
    await waitFor(async () => expect((await repo.tasks.get(task.id))?.status).toBe('done'));
    const stored = (await repo.tasks.get(task.id))!;
    expect(stored.actualMin).toBe(90);
    expect(stored.completedAt).toBe(clock.now().toISOString());
    expect(screen.queryByTestId('complete-dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('closed')).toHaveTextContent('1');
    expect(useToastStore.getState().toasts[0]?.description).toBe('Write intro · 1h 30m');
  });

  it('rejects text it cannot parse and lets the user skip', async () => {
    const user = userEvent.setup();
    const { repo, task } = await seed(30);
    renderWithProviders(<Harness task={task} />, { repository: repo });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    const input = await screen.findByRole('textbox', { name: 'Actual time' });
    await user.clear(input);
    await user.type(input, 'a while{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter minutes like 25, 1h, or 1h30.',
    );
    expect((await repo.tasks.get(task.id))?.status).toBe('open');

    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(async () => expect((await repo.tasks.get(task.id))?.status).toBe('done'));
    expect((await repo.tasks.get(task.id))?.actualMin).toBeNull();
  });

  it('skips itself when the task already has a session, taking the actual from it', async () => {
    const user = userEvent.setup();
    const { repo, task } = await seed(30);
    await repo.sessions.upsert(
      createRecord(SessionSchema, clock, {
        taskId: task.id,
        startAt: '2026-09-14T12:00:00.000Z',
        endAt: '2026-09-14T12:40:00.000Z',
      }),
    );
    // And a timer still running on it: completing stops it and counts it too.
    await repo.sessions.upsert(
      createRecord(SessionSchema, clock, {
        taskId: task.id,
        startAt: new Date(clock.now().getTime() - 5 * 60_000).toISOString(),
        endAt: null,
      }),
    );
    renderWithProviders(<Harness task={task} />, { repository: repo });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(async () => expect((await repo.tasks.get(task.id))?.status).toBe('done'));
    expect(screen.queryByTestId('complete-dialog')).not.toBeInTheDocument();
    expect((await repo.tasks.get(task.id))?.actualMin).toBe(45);
    expect((await repo.sessions.query((s) => s.endAt === null)).length).toBe(0);
    expect(screen.getByTestId('closed')).toHaveTextContent('1');
  });
});
