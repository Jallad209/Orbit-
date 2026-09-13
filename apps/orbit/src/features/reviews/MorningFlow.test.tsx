import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AreaSchema,
  BillSchema,
  GoalSchema,
  ProjectSchema,
  TaskSchema,
  createRecord,
  fixedClock,
} from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { Route, Routes } from 'react-router';
import { useToastStore } from '@/components/ui/toastStore';
import { usePlanPrefs } from '@/features/today/planSettings';
import { renderWithProviders } from '@/test/render';
import { MorningFlow } from './MorningFlow';

// Monday 14 Sep 2026, 08:00.
const clock = fixedClock(new Date(2026, 8, 14, 8, 0, 0));
const DATE = '2026-09-14';

async function seed() {
  const repo = createMemoryRepository({ clock });
  const area = createRecord(AreaSchema, clock, { name: 'Study' });
  const goal = createRecord(GoalSchema, clock, { title: 'Graduate', areaId: area.id });
  const project = createRecord(ProjectSchema, clock, {
    title: 'Thesis',
    areaId: area.id,
    goalId: goal.id,
    deadline: '2026-09-19',
  });
  const overdue = createRecord(TaskSchema, clock, {
    title: 'Send the draft',
    projectId: project.id,
    areaId: area.id,
    status: 'open',
    priority: 1,
    dueAt: '2026-09-10T12:00:00.000Z',
  });
  const deep = createRecord(TaskSchema, clock, {
    title: 'Deep proof',
    projectId: project.id,
    areaId: area.id,
    status: 'open',
    energy: 'high',
    estimateMin: 60,
  });
  const cards = createRecord(TaskSchema, clock, {
    title: 'Make flash cards',
    areaId: area.id,
    status: 'open',
    estimateMin: 30,
  });
  const bill = createRecord(BillSchema, clock, { title: 'Rent', amount: 900, dueAt: '2026-09-16' });
  const later = createRecord(BillSchema, clock, { title: 'Gym', amount: 40, dueAt: '2026-09-30' });
  await repo.transaction(async (tx) => {
    await tx.areas.upsert(area);
    await tx.goals.upsert(goal);
    await tx.projects.upsert({ ...project, nextActionTaskId: overdue.id });
    for (const t of [overdue, deep, cards]) await tx.tasks.upsert(t);
    await tx.bills.upsert(bill);
    await tx.bills.upsert(later);
  });
  return { repo, area, project, overdue, deep, cards };
}

function render(repo: Awaited<ReturnType<typeof seed>>['repo']) {
  return renderWithProviders(
    <Routes>
      <Route path="/review/morning" element={<MorningFlow clock={clock} />} />
      <Route path="/today" element={<h1>Today screen</h1>} />
    </Routes>,
    { repository: repo, route: `/review/morning?date=${DATE}` },
  );
}

describe('MorningFlow', () => {
  beforeEach(() => {
    usePlanPrefs.setState({ energyByDate: {} });
    useToastStore.getState().clear();
  });

  it('sets the energy with a hotkey and passes it through to the planner and the commitment', async () => {
    const user = userEvent.setup();
    const { repo, deep } = await seed();
    render(repo);
    const flow = await screen.findByTestId('morning-flow');
    expect(flow).toHaveAttribute('data-step', '0');
    expect(screen.getByRole('radio', { name: /medium/ })).toBeChecked();

    await user.keyboard('3');
    expect(screen.getByRole('radio', { name: /high/ })).toBeChecked();
    expect(usePlanPrefs.getState().energyByDate[DATE]).toBe('high');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(flow).toHaveAttribute('data-step', '1');
    // The hotkeys only act on the energy step.
    await user.keyboard('1');
    expect(usePlanPrefs.getState().energyByDate[DATE]).toBe('high');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    const plan = await screen.findByTestId('morning-plan');
    expect(plan).toHaveAttribute('data-energy', 'high');
    // High energy lets the high-energy task in.
    expect(within(plan).getByTestId(`plan-row-${deep.id}`)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('morning-summary')).toHaveTextContent('high energy');
    await user.click(screen.getByRole('button', { name: 'Accept plan' }));

    await waitFor(async () => expect(await repo.dayCommitments.count()).toBe(1));
    const commitment = (await repo.dayCommitments.list())[0]!;
    expect(commitment.date).toBe(DATE);
    expect(commitment.energy).toBe('high');
    expect(commitment.acceptedTaskIds).toContain(deep.id);
    expect(await screen.findByRole('heading', { name: 'Today screen' })).toBeInTheDocument();
    expect(useToastStore.getState().toasts[0]?.title).toBe('Plan committed');
  });

  it('shows what is at risk and which bills are due within three days', async () => {
    const user = userEvent.setup();
    const { repo } = await seed();
    render(repo);
    await screen.findByTestId('morning-flow');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const atRisk = await screen.findByTestId('morning-at-risk');
    expect(within(atRisk).getByText('Overdue')).toBeInTheDocument();
    expect(within(atRisk).getByText('Send the draft')).toBeInTheDocument();
    // Thesis: deadline in 5 days, 0 of 2 tasks done → at risk.
    expect(within(atRisk).getByText('5d left')).toBeInTheDocument();
    expect(within(atRisk).getByRole('link', { name: 'Thesis' })).toBeInTheDocument();
    const bills = screen.getByTestId('morning-bills');
    expect(within(bills).getByText('Rent')).toBeInTheDocument();
    expect(within(bills).queryByText('Gym')).not.toBeInTheDocument();
  });

  it('accepting from the plan step works too, and a low day leaves demanding work out', async () => {
    const user = userEvent.setup();
    const { repo, deep } = await seed();
    render(repo);
    await screen.findByTestId('morning-flow');
    await user.click(screen.getByRole('radio', { name: /low/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const plan = await screen.findByTestId('morning-plan');
    expect(plan).toHaveAttribute('data-energy', 'low');
    expect(within(plan).getByTestId(`left-out-${deep.id}`)).toHaveAttribute(
      'data-reason',
      'energy',
    );
    await user.click(within(plan).getByRole('button', { name: 'Accept' }));
    await waitFor(async () => expect(await repo.dayCommitments.count()).toBe(1));
    expect((await repo.dayCommitments.list())[0]!.energy).toBe('low');
  });
});
