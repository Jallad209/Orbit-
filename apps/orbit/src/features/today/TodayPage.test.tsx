import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AreaSchema,
  GoalSchema,
  ProjectSchema,
  TaskSchema,
  createRecord,
  fixedClock,
} from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { useToastStore } from '@/components/ui/toastStore';
import { renderWithProviders } from '@/test/render';
import { usePlanPrefs } from './planSettings';
import { TodayPage } from './TodayPage';

// Monday 14 Sep 2026, 08:00: the whole working window is ahead.
const clock = fixedClock(new Date(2026, 8, 14, 8, 0, 0));
const DATE = '2026-09-14';

async function seed() {
  const repo = createMemoryRepository({ clock });
  const area = createRecord(AreaSchema, clock, { name: 'Study' });
  const goal = createRecord(GoalSchema, clock, {
    title: 'Graduate',
    areaId: area.id,
    importance: 5,
  });
  const project = createRecord(ProjectSchema, clock, {
    title: 'Thesis',
    areaId: area.id,
    goalId: goal.id,
    deadline: '2026-09-20',
  });
  const overdue = createRecord(TaskSchema, clock, {
    title: 'Send the draft',
    projectId: project.id,
    areaId: area.id,
    status: 'open',
    priority: 1,
    estimateMin: 60,
    dueAt: '2026-09-10T00:00:00.000Z',
  });
  const intro = createRecord(TaskSchema, clock, {
    title: 'Write intro',
    projectId: project.id,
    areaId: area.id,
    status: 'open',
    estimateMin: 90,
  });
  const cards = createRecord(TaskSchema, clock, {
    title: 'Make flash cards',
    areaId: area.id,
    status: 'open',
    estimateMin: 30,
  });
  const blocked = createRecord(TaskSchema, clock, {
    title: 'Methods chapter',
    projectId: project.id,
    areaId: area.id,
    status: 'open',
    dependsOn: [intro.id],
  });
  await repo.transaction(async (tx) => {
    await tx.areas.upsert(area);
    await tx.goals.upsert(goal);
    await tx.projects.upsert({ ...project, nextActionTaskId: intro.id });
    for (const t of [overdue, intro, cards, blocked]) await tx.tasks.upsert(t);
  });
  return { repo, area, project, overdue, intro, cards, blocked };
}

function render(repo: Awaited<ReturnType<typeof seed>>['repo']) {
  return renderWithProviders(<TodayPage clock={clock} date={DATE} />, {
    repository: repo,
    route: '/today',
  });
}

describe('TodayPage', () => {
  beforeEach(() => {
    usePlanPrefs.setState({ energyByDate: {} });
    useToastStore.getState().clear();
  });

  it('renders the next action from the proposal and the blocked task in left-out', async () => {
    const { repo, blocked } = await seed();
    render(repo);
    const focus = await screen.findByTestId('focus');
    expect(within(focus).getByRole('heading', { level: 2 })).toHaveTextContent('Send the draft');
    expect(within(focus).getByText(/09:00–10:00/)).toBeInTheDocument();

    const plan = screen.getByRole('list', { name: 'Proposed plan' });
    const rows = within(plan).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Send the draft');
    expect(rows).toHaveLength(3);
    const left = screen.getByTestId(`left-out-${blocked.id}`);
    expect(left).toHaveAttribute('data-reason', 'blocked');
    expect(within(left).getByText('Blocked')).toBeInTheDocument();
  });

  it('opens a "why" popover listing the explanation components', async () => {
    const user = userEvent.setup();
    const { repo } = await seed();
    render(repo);
    await screen.findByTestId('focus');
    await user.click(screen.getByRole('button', { name: 'Why Send the draft' }));
    const popover = await screen.findByTestId('why-popover');
    const reasons = within(popover).getByRole('list', { name: 'Reasons' });
    expect(
      within(reasons)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      '•Due 4 days ago',
      '•Goal “Graduate” is importance 5/5',
      '•Priority 1',
      '•Matches a medium-energy day',
    ]);
    expect(within(popover).getByText('Deadline pressure')).toBeInTheDocument();
    expect(within(popover).getByText('Overdue boost')).toBeInTheDocument();
    expect(within(popover).getByText(/Placed 09:00–10:00/)).toBeInTheDocument();
  });

  it('removing a proposed task moves it to left-out with reason "user", and it can come back', async () => {
    const user = userEvent.setup();
    const { repo, cards } = await seed();
    render(repo);
    await screen.findByTestId('focus');
    await user.click(screen.getByRole('button', { name: 'Remove Make flash cards' }));
    const left = await screen.findByTestId(`left-out-${cards.id}`);
    expect(left).toHaveAttribute('data-reason', 'user');
    expect(within(left).getByText('Removed')).toBeInTheDocument();
    expect(screen.queryByTestId(`plan-row-${cards.id}`)).not.toBeInTheDocument();

    await user.click(within(left).getByRole('button', { name: 'Add back Make flash cards' }));
    expect(await screen.findByTestId(`plan-row-${cards.id}`)).toBeInTheDocument();
  });

  it('accept writes the commitment and blocks and switches the panel to committed', async () => {
    const user = userEvent.setup();
    const { repo, overdue, intro, cards } = await seed();
    render(repo);
    await screen.findByTestId('focus');
    await user.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(async () => expect(await repo.dayCommitments.count()).toBe(1));
    const commitment = (await repo.dayCommitments.list())[0]!;
    expect(commitment.date).toBe(DATE);
    expect(commitment.acceptedTaskIds).toEqual([overdue.id, intro.id, cards.id]);
    expect(await repo.blocks.count()).toBe(3);

    const panel = await screen.findByTestId('plan-panel');
    await waitFor(() => expect(panel).toHaveAttribute('data-mode', 'committed'));
    expect(within(panel).getByRole('list', { name: 'Committed plan' })).toBeInTheDocument();
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain('Plan committed');

    // Re-plan shows a proposal again; accepting twice updates the same commitment.
    await user.click(screen.getByRole('button', { name: 'Re-plan' }));
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(async () => expect(await repo.blocks.count()).toBe(3));
    expect(await repo.dayCommitments.count()).toBe(1);
  });

  it('regenerate highlights what was added and names what was dropped', async () => {
    const user = userEvent.setup();
    const { repo, area, cards } = await seed();
    render(repo);
    await screen.findByTestId('focus');

    // The world changes behind the screen: one task done, one new.
    await repo.tasks.upsert({ ...cards, status: 'done' });
    const fresh = createRecord(TaskSchema, clock, {
      title: 'Email the supervisor',
      areaId: area.id,
      status: 'open',
      estimateMin: 15,
      priority: 1,
      dueAt: '2026-09-14T00:00:00.000Z',
    });
    await repo.tasks.upsert(fresh);

    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    const row = await screen.findByTestId(`plan-row-${fresh.id}`);
    expect(within(row).getByText('New')).toBeInTheDocument();
    expect(screen.getByTestId('plan-diff')).toHaveTextContent(
      'Dropped since last plan: Make flash cards',
    );
  });

  it('switching energy to low leaves high-energy work out with reason "energy"', async () => {
    const user = userEvent.setup();
    const { repo, area } = await seed();
    const deep = createRecord(TaskSchema, clock, {
      title: 'Deep proof',
      areaId: area.id,
      status: 'open',
      energy: 'high',
    });
    await repo.tasks.upsert(deep);
    render(repo);
    await screen.findByTestId(`plan-row-${deep.id}`);
    await user.click(screen.getByRole('radio', { name: 'low' }));
    const left = await screen.findByTestId(`left-out-${deep.id}`);
    expect(left).toHaveAttribute('data-reason', 'energy');
  });

  it('offers the morning briefing until the plan is accepted', async () => {
    const user = userEvent.setup();
    const { repo } = await seed();
    render(repo);
    await screen.findByTestId('focus');
    expect(screen.getByRole('link', { name: 'Start morning briefing' })).toHaveAttribute(
      'href',
      `/review/morning?date=${DATE}`,
    );
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: 'Start morning briefing' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('starts a timer on the focus task, shows it counting, and Done completes from the sessions', async () => {
    const user = userEvent.setup();
    const { repo, overdue } = await seed();
    document.title = 'Orbit';
    render(repo);
    const focus = await screen.findByTestId('focus');
    await user.click(within(focus).getByRole('button', { name: 'Start' }));
    const stop = await within(focus).findByRole('button', { name: 'Stop' });
    expect(stop).toHaveAttribute('aria-pressed', 'true');
    expect(within(focus).getByTestId('timer-elapsed')).toHaveTextContent('0:00');
    expect(document.title).toBe('0:00 · Send the draft');
    clock.advance(10 * 60_000);

    // Done with a session behind it: no prompt, the actual comes from the timer.
    await user.click(within(focus).getByRole('button', { name: 'Done' }));
    await waitFor(async () => expect((await repo.tasks.get(overdue.id))?.status).toBe('done'));
    expect((await repo.tasks.get(overdue.id))?.actualMin).toBe(10);
    expect(screen.queryByTestId('complete-dialog')).not.toBeInTheDocument();
    expect(await repo.sessions.query((s) => s.endAt === null)).toEqual([]);
    await waitFor(() => expect(document.title).toBe('Orbit'));
  });

  it('Done without a timer asks how long the task took', async () => {
    const user = userEvent.setup();
    const { repo, overdue } = await seed();
    render(repo);
    const focus = await screen.findByTestId('focus');
    await user.click(within(focus).getByRole('button', { name: 'Done' }));
    const input = await screen.findByRole('textbox', { name: 'Actual time' });
    expect(input).toHaveValue('1h'); // the 60-minute estimate
    await user.clear(input);
    await user.type(input, '45{Enter}');
    await waitFor(async () => expect((await repo.tasks.get(overdue.id))?.actualMin).toBe(45));
  });

  it('shows at-risk items and the insight strip with evidence', async () => {
    const user = userEvent.setup();
    const { repo } = await seed();
    render(repo);
    const atRisk = await screen.findByTestId('at-risk');
    expect(within(atRisk).getByText('Overdue')).toBeInTheDocument();
    expect(within(atRisk).getByText('Send the draft')).toBeInTheDocument();
    expect(within(atRisk).getByText('6d left')).toBeInTheDocument();

    const insights = screen.getByTestId('insights');
    const button = within(insights).getByRole('button', { name: /1 task is overdue/ });
    await user.click(button);
    expect(within(insights).getByRole('list', { name: 'Evidence' })).toHaveTextContent(
      '“Send the draft” was due 2026-09-10',
    );
  });
});
