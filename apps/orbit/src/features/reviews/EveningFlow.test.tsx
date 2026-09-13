import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AreaSchema,
  DayCommitmentSchema,
  SessionSchema,
  TaskSchema,
  createRecord,
  fixedClock,
  toLocalDate,
} from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { Route, Routes } from 'react-router';
import { useToastStore } from '@/components/ui/toastStore';
import { renderWithProviders } from '@/test/render';
import { EveningFlow } from './EveningFlow';

// Wednesday 16 Sep 2026, 18:30 local: next Monday is the 21st.
const clock = fixedClock(new Date(2026, 8, 16, 18, 30, 0));
const DATE = '2026-09-16';
const at = (h: number, m = 0) => new Date(2026, 8, 16, h, m).toISOString();

async function seed() {
  const repo = createMemoryRepository({ clock });
  const study = createRecord(AreaSchema, clock, { name: 'Study' });
  const health = createRecord(AreaSchema, clock, { name: 'Health' });
  const timed = createRecord(TaskSchema, clock, {
    title: 'Write intro',
    areaId: study.id,
    status: 'done',
    estimateMin: 60,
    actualMin: 90,
    completedAt: at(11),
  });
  const untimed = createRecord(TaskSchema, clock, {
    title: 'Email the supervisor',
    areaId: study.id,
    status: 'done',
    estimateMin: 15,
    actualMin: null,
    completedAt: at(14),
  });
  const p1 = createRecord(TaskSchema, clock, {
    title: 'Literature review',
    areaId: study.id,
    status: 'open',
    priority: 1,
    dueAt: at(17),
  });
  const p3 = createRecord(TaskSchema, clock, {
    title: 'Sort the bookshelf',
    areaId: health.id,
    status: 'open',
    priority: 3,
  });
  const notCommitted = createRecord(TaskSchema, clock, {
    title: 'Not today',
    areaId: study.id,
    status: 'open',
  });
  const commitment = createRecord(DayCommitmentSchema, clock, {
    date: DATE,
    acceptedTaskIds: [timed.id, untimed.id, p1.id, p3.id],
    energy: 'medium',
    acceptedAt: at(8),
  });
  const sessions = [
    createRecord(SessionSchema, clock, { taskId: timed.id, startAt: at(9), endAt: at(10, 30) }),
    createRecord(SessionSchema, clock, { taskId: p3.id, startAt: at(16), endAt: at(16, 20) }),
  ];
  await repo.transaction(async (tx) => {
    await tx.areas.upsert(study);
    await tx.areas.upsert(health);
    for (const t of [timed, untimed, p1, p3, notCommitted]) await tx.tasks.upsert(t);
    await tx.dayCommitments.upsert(commitment);
    for (const s of sessions) await tx.sessions.upsert(s);
  });
  return { repo, study, health, timed, untimed, p1, p3, notCommitted };
}

function render(repo: Awaited<ReturnType<typeof seed>>['repo'], date = DATE) {
  return renderWithProviders(
    <Routes>
      <Route path="/review/evening" element={<EveningFlow clock={clock} />} />
      <Route path="/today" element={<h1>Today screen</h1>} />
    </Routes>,
    { repository: repo, route: `/review/evening?date=${date}` },
  );
}

describe('EveningFlow', () => {
  beforeEach(() => useToastStore.getState().clear());

  it('lists exactly the unfinished committed tasks for rollover', async () => {
    const user = userEvent.setup();
    const { repo, timed, untimed, p1, p3, notCommitted } = await seed();
    render(repo);
    const committed = await screen.findByTestId('evening-committed');
    expect(committed).toHaveTextContent('2 of 4 committed tasks done');
    expect(
      within(screen.getByTestId(`committed-${timed.id}`)).getByText('Done'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId(`committed-${untimed.id}`)).getByText('Done'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId(`committed-${p1.id}`)).getByText('Unfinished'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(`committed-${notCommitted.id}`)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const list = await screen.findByRole('list', { name: 'Unfinished tasks' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      `rollover-${p1.id}`,
      `rollover-${p3.id}`,
    ]);
    // Suggestions follow the default rule: P1 tomorrow, P3 next week.
    expect(within(rows[0]!).getByRole('radio', { name: 'Tomorrow' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(rows[1]!).getByRole('radio', { name: 'Next week' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('asks for the missing actual, submits every rollover choice, and closes the day in one go', async () => {
    const user = userEvent.setup();
    const { repo, untimed, p1, p3, study, health } = await seed();
    render(repo);
    await screen.findByTestId('evening-committed');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const actuals = await screen.findByRole('list', { name: 'Actuals' });
    const input = within(actuals).getByRole('textbox');
    expect(input).toHaveValue('15m'); // prefilled from the estimate
    expect(within(actuals).getByText('Email the supervisor')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, 'soon');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter minutes');
    await user.clear(input);
    await user.type(input, '25');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Change the P3 choice from next week to inbox; keep P1 on tomorrow.
    const p3Row = await screen.findByTestId(`rollover-${p3.id}`);
    await user.click(within(p3Row).getByRole('radio', { name: 'Inbox' }));
    expect(within(p3Row).getByRole('radio', { name: 'Inbox' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const summary = await screen.findByTestId('evening-summary');
    expect(summary).toHaveTextContent('2 of 4 committed tasks done');
    expect(summary).toHaveTextContent('1 to tomorrow · 0 to next week · 1 back to inbox');
    const time = screen.getByTestId('evening-time-by-area');
    expect(time).toHaveTextContent('1h 50m');
    const bars = within(time).getAllByRole('listitem');
    expect(bars[0]).toHaveTextContent('Study');
    expect(bars[0]).toHaveTextContent('1h 30m');
    expect(bars[1]).toHaveTextContent('Health');
    expect(bars[1]).toHaveTextContent('20m');
    expect(study.id).not.toBe(health.id);

    await user.click(screen.getByRole('button', { name: 'Close the day' }));
    await waitFor(async () => expect((await repo.tasks.get(untimed.id))?.actualMin).toBe(25));
    const movedP1 = (await repo.tasks.get(p1.id))!;
    expect(toLocalDate(new Date(movedP1.dueAt!))).toBe('2026-09-17');
    expect(new Date(movedP1.dueAt!).getHours()).toBe(17); // its own due time survives
    expect(movedP1.status).toBe('open');
    const movedP3 = (await repo.tasks.get(p3.id))!;
    expect(movedP3.status).toBe('inbox');
    expect(movedP3.dueAt).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Today screen' })).toBeInTheDocument();
    expect(useToastStore.getState().toasts[0]?.description).toBe('2 done · 2 rolled over');
  });

  it('rolls a P3 task to next Monday by default', async () => {
    const user = userEvent.setup();
    const { repo, p3 } = await seed();
    render(repo);
    await screen.findByTestId('evening-committed');
    for (let i = 0; i < 3; i += 1) await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('button', { name: 'Close the day' }));
    await waitFor(async () => expect((await repo.tasks.get(p3.id))?.dueAt).not.toBeNull());
    expect(toLocalDate(new Date((await repo.tasks.get(p3.id))!.dueAt!))).toBe('2026-09-21');
  });

  it('explains an empty day instead of failing', async () => {
    const user = userEvent.setup();
    const { repo } = await seed();
    render(repo, '2026-09-15');
    expect(await screen.findByTestId('evening-no-commitment')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByTestId('evening-no-actuals')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByTestId('evening-nothing-unfinished')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('evening-time-by-area')).toHaveTextContent('No sessions recorded');
  });
});
