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

async function seed(includeTasks = true) {
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
    await tx.projects.upsert({
      ...project,
      nextActionTaskId: includeTasks ? overdue.id : null,
    });
    if (includeTasks) for (const t of [overdue, deep, cards]) await tx.tasks.upsert(t);
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

async function skipCheckIns(user: ReturnType<typeof userEvent.setup>) {
  for (let index = 0; index < 3; index += 1) {
    await user.click(screen.getByRole('button', { name: 'No, continue' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
  }
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
    await skipCheckIns(user);
    expect(flow).toHaveAttribute('data-step', '3');
    expect(screen.getByRole('radio', { name: /medium/ })).toBeChecked();

    await user.keyboard('3');
    expect(screen.getByRole('radio', { name: /high/ })).toBeChecked();
    expect(usePlanPrefs.getState().energyByDate[DATE]).toBe('high');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(flow).toHaveAttribute('data-step', '4');
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
  }, 15_000);

  it('shows what is at risk and which bills are due within three days', async () => {
    const user = userEvent.setup();
    const { repo } = await seed();
    render(repo);
    await screen.findByTestId('morning-flow');
    await skipCheckIns(user);
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

  it('guides project, bill, and person capture one question at a time', async () => {
    const user = userEvent.setup();
    const { repo, area } = await seed(false);
    render(repo);
    await screen.findByTestId('morning-flow');

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Yes, add one' }));
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.type(screen.getByLabelText('Project name'), 'Publish portfolio');
    await user.type(screen.getByLabelText(/Target date/), '2026-10-10');
    await user.click(screen.getByRole('button', { name: 'Add project' }));
    await waitFor(async () =>
      expect(
        (await repo.projects.list()).some((project) => project.title === 'Publish portfolio'),
      ).toBe(true),
    );
    const project = (await repo.projects.list()).find(
      (candidate) => candidate.title === 'Publish portfolio',
    );
    expect(project).toMatchObject({ areaId: area.id, deadline: '2026-10-10' });
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Yes, add one' }));
    await user.type(screen.getByLabelText('Bill name'), 'Cloud storage');
    await user.type(screen.getByLabelText(/Amount/), '7.50');
    await user.click(screen.getByRole('button', { name: 'Add bill' }));
    await waitFor(async () => expect(await repo.bills.count()).toBe(3));
    const bill = (await repo.bills.list()).find((candidate) => candidate.title === 'Cloud storage');
    expect(bill).toMatchObject({ amount: 7.5, dueAt: null, dueTime: null });

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Yes, add one' }));
    await user.type(screen.getByLabelText('Name'), 'Lina');
    await user.type(screen.getByLabelText(/Follow-up date/), '2026-09-20');
    await user.type(screen.getByLabelText(/Follow-up time/), '15:30');
    await user.click(screen.getByRole('button', { name: 'Add person' }));
    await waitFor(async () => expect(await repo.people.count()).toBe(1));
    expect((await repo.people.list())[0]).toMatchObject({
      name: 'Lina',
      followUpDate: '2026-09-20',
      followUpTime: 930,
    });
    expect(await repo.reminders.list()).toEqual([
      expect.objectContaining({
        source: 'person-follow-up',
        fireAt: expect.any(String),
        destination: expect.stringMatching(/^\/people\//),
      }),
    ]);
  }, 15_000);

  it('accepting from the plan step works too, and a low day leaves demanding work out', async () => {
    const user = userEvent.setup();
    const { repo, deep } = await seed();
    render(repo);
    await screen.findByTestId('morning-flow');
    await skipCheckIns(user);
    await user.click(screen.getByRole('radio', { name: /low/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const plan = await screen.findByTestId('morning-plan');
    expect(plan).toHaveAttribute('data-energy', 'low');
    expect(within(plan).getByTestId(`left-out-${deep.id}`)).toHaveAttribute(
      'data-reason',
      'energy',
    );
    await user.click(within(plan).getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('morning-summary')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept plan' }));
    await waitFor(async () => expect(await repo.dayCommitments.count()).toBe(1));
    expect((await repo.dayCommitments.list())[0]!.energy).toBe('low');
  });

  it('adds multiple tasks with an optional start and duration without leaving the briefing', async () => {
    const user = userEvent.setup();
    const { repo, project } = await seed(false);
    render(repo);
    const flow = await screen.findByTestId('morning-flow');
    await skipCheckIns(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const plan = await screen.findByTestId('morning-plan');
    expect(within(plan).getByText('Nothing to plan')).toBeInTheDocument();
    await user.click(within(plan).getByRole('button', { name: 'Capture a task' }));

    const form = within(plan).getByRole('region', { name: 'Add a task' });
    await user.type(within(form).getByLabelText('Task'), 'Outline literature review');
    expect(within(form).getByLabelText(/Project/)).toHaveValue(project.id);
    expect(within(form).getByLabelText(/Plan date/)).toHaveValue(DATE);
    await user.type(within(form).getByLabelText(/Start time/), '14:00');
    await user.type(within(form).getByLabelText(/Duration/), '45');
    await user.click(within(form).getByRole('button', { name: 'Add task' }));

    expect(flow).toHaveAttribute('data-step', '5');
    await waitFor(() =>
      expect(within(plan).getByText('Outline literature review')).toBeInTheDocument(),
    );
    const task = (await repo.tasks.list()).find(
      (candidate) => candidate.title === 'Outline literature review',
    );
    expect(task).toMatchObject({
      status: 'open',
      projectId: project.id,
      estimateMin: 45,
      preferredDate: DATE,
      preferredStartMin: 14 * 60,
    });
    expect(within(plan).getByText('14:00–14:45')).toBeInTheDocument();

    expect(within(form).getByLabelText('Task')).toHaveValue('');
    await user.type(within(form).getByLabelText('Task'), 'Prepare citations');
    await user.type(within(form).getByLabelText(/Start time/), '15:15');
    await user.type(within(form).getByLabelText(/Duration/), '60');
    await user.click(within(form).getByRole('button', { name: 'Add task' }));
    await waitFor(async () =>
      expect(
        (await repo.tasks.list()).filter((candidate) => candidate.status === 'open'),
      ).toHaveLength(2),
    );
    expect(within(form).getByLabelText('Task')).toHaveValue('');
    expect(within(form).getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(useToastStore.getState().toasts[0]?.title).toBe('Task added');
  }, 15_000);

  it('lets the user accept an intentionally empty day from the final step', async () => {
    const user = userEvent.setup();
    const { repo } = await seed(false);
    render(repo);
    const flow = await screen.findByTestId('morning-flow');
    await skipCheckIns(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const plan = await screen.findByTestId('morning-plan');
    expect(within(plan).getByText('Nothing to plan')).toBeInTheDocument();
    await user.click(within(plan).getByRole('button', { name: 'Continue' }));

    expect(flow).toHaveAttribute('data-step', '6');
    expect(screen.getByTestId('morning-summary')).toHaveTextContent(
      'keep the day intentionally open',
    );
    const accept = screen.getByRole('button', { name: 'Accept plan' });
    expect(accept).toBeEnabled();
    await user.click(accept);

    await waitFor(async () => expect(await repo.dayCommitments.count()).toBe(1));
    expect((await repo.dayCommitments.list())[0]?.acceptedTaskIds).toEqual([]);
    expect(await screen.findByRole('heading', { name: 'Today screen' })).toBeInTheDocument();
  }, 15_000);
});
