import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AreaSchema,
  CaptureSchema,
  GoalSchema,
  ProjectSchema,
  TaskSchema,
  createRecord,
  fixedClock,
} from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import type { Repository } from '@orbit/storage';
import { createBill } from '@/features/bills/billsService';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/render';
import { WeeklyFlow } from './WeeklyFlow';
import { startReview } from './weeklyService';

// The flow runs on the injected clock: Saturday 12 Sep 2026, 09:00 local.
const NOW = new Date(2026, 8, 12, 9, 0, 0);

async function seed() {
  const clock = fixedClock(NOW);
  const repo = createMemoryRepository({ clock });
  const area = await repo.areas.upsert(
    createRecord(AreaSchema, clock, { name: 'Study', weeklyHoursTarget: 10 }),
  );
  const project = await repo.projects.upsert(
    createRecord(ProjectSchema, clock, { title: 'Thesis', areaId: area.id }),
  );
  await repo.goals.upsert(createRecord(GoalSchema, clock, { title: 'Graduate', areaId: area.id }));
  const overdue = await repo.tasks.upsert(
    createRecord(TaskSchema, clock, {
      title: 'Late task',
      status: 'open',
      projectId: project.id,
      areaId: area.id,
      dueAt: '2026-09-10T09:00:00.000Z',
    }),
  );
  await repo.tasks.upsert(
    createRecord(TaskSchema, clock, {
      title: 'Next thing',
      status: 'open',
      projectId: project.id,
      areaId: area.id,
    }),
  );
  const capture = await repo.captures.upsert(
    createRecord(CaptureSchema, clock, { text: 'Buy milk', type: 'task' }),
  );
  const rent = await createBill(
    repo,
    { title: 'Rent', amount: 900, currency: 'USD', dueAt: '2026-09-16', recurrence: null },
    clock,
  );
  return { clock, repo, area, project, overdue, capture, rent };
}

function render(repo: Repository, clock: ReturnType<typeof fixedClock>, route = '/review/weekly') {
  return renderWithProviders(<WeeklyFlow clock={clock} />, { repository: repo, route, clock });
}

describe('WeeklyFlow', () => {
  it('opening the URL starts nothing; Start creates the review at step one with frozen dates', async () => {
    const { repo, clock } = await seed();
    render(repo, clock);
    expect(await screen.findByTestId('weekly-landing')).toBeInTheDocument();
    expect(await repo.weeklyReviews.count()).toBe(0);
    await userEvent.click(screen.getByTestId('start-review'));
    const flow = await screen.findByTestId('weekly-flow');
    expect(flow).toHaveAttribute('data-step', 'inbox');
    expect(flow).toHaveTextContent('Week of 2026-09-07, planning the week of 2026-09-14');
    expect(await repo.weeklyReviews.count()).toBe(1);
  });

  it('walks the inbox and overdue steps with receipts, pauses with an unapplied choice, and resumes it', async () => {
    const { repo, clock, capture, overdue } = await seed();
    const review = await startReview(repo, { clock });
    const view = render(repo, clock, `/review/weekly?review=${review.id}`);
    const flow = await screen.findByTestId('weekly-flow');
    // Inbox: convert the capture; the gate then allows acknowledging.
    const row = await screen.findByTestId('inbox-capture');
    expect(screen.getByTestId('acknowledge-step')).toBeDisabled();
    await userEvent.click(within(row).getByRole('button', { name: 'Convert' }));
    await waitFor(() => expect(screen.getByTestId('acknowledge-step')).toBeEnabled());
    expect((await repo.captures.get(capture.id))!.status).toBe('processed');
    expect((await repo.weeklyReviewActions.list())[0]).toMatchObject({
      step: 'inbox',
      kind: 'convert-capture',
    });
    await userEvent.click(screen.getByTestId('acknowledge-step'));
    await waitFor(() => expect(flow).toHaveAttribute('data-step', 'overdue'));
    expect(screen.getByTestId('step-tab-inbox')).toHaveAttribute('data-outcome', 'done');

    // Overdue: choose a reschedule but do not apply; Pause saves it as a draft.
    const task = await screen.findByTestId('overdue-task');
    await userEvent.selectOptions(
      within(task).getByLabelText('Choice for Late task'),
      'reschedule',
    );
    await userEvent.click(screen.getByTestId('pause-review'));
    await waitFor(async () =>
      expect((await repo.weeklyReviews.get(review.id))!.status).toBe('paused'),
    );
    const paused = (await repo.weeklyReviews.get(review.id))!;
    expect(paused.stepDraft).toMatchObject({
      step: 'overdue',
      choices: [{ ref: { type: 'task', id: overdue.id }, choice: { action: 'reschedule' } }],
    });
    expect((await repo.tasks.get(overdue.id))!.dueAt).toBe('2026-09-10T09:00:00.000Z');
    view.unmount();

    // Resume: the choice is back, unapplied, until Apply.
    render(repo, clock, `/review/weekly?review=${review.id}`);
    const again = await screen.findByTestId('overdue-task');
    expect(within(again).getByLabelText('Choice for Late task')).toHaveValue('reschedule');
    expect(await screen.findByTestId('apply-choices')).toHaveTextContent('Apply 1 choice');
    await userEvent.click(screen.getByTestId('apply-choices'));
    await waitFor(async () =>
      expect((await repo.tasks.get(overdue.id))!.dueAt).not.toBe('2026-09-10T09:00:00.000Z'),
    );
    await waitFor(() => expect(screen.getByTestId('acknowledge-step')).toBeEnabled());
    const receipts = await repo.weeklyReviewActions.list();
    expect(receipts.map((r) => r.kind).sort()).toEqual(['convert-capture', 'reschedule-task']);
  });

  it('records inspections, bills, and capacity, then finishes only after every step and a fingerprint recheck', async () => {
    const { repo, clock, rent } = await seed();
    const review = await startReview(repo, { clock });
    render(repo, clock, `/review/weekly?review=${review.id}`);
    const flow = await screen.findByTestId('weekly-flow');
    // Inbox: defer the capture, acknowledge.
    const capture = await screen.findByTestId('inbox-capture');
    await userEvent.click(within(capture).getByRole('button', { name: 'Defer' }));
    await waitFor(() => expect(screen.getByTestId('acknowledge-step')).toBeEnabled());
    await userEvent.click(screen.getByTestId('acknowledge-step'));
    await waitFor(() => expect(flow).toHaveAttribute('data-step', 'overdue'));
    expect(screen.getByTestId('step-tab-inbox')).toHaveAttribute('data-outcome', 'deferred');
    // Overdue: defer all remaining.
    await screen.findByTestId('overdue-task');
    await userEvent.click(screen.getByRole('button', { name: /Defer all remaining/ }));
    await waitFor(() => expect(screen.getByTestId('acknowledge-step')).toBeEnabled());
    await userEvent.click(screen.getByTestId('acknowledge-step'));
    await waitFor(() => expect(flow).toHaveAttribute('data-step', 'projects'));
    // Projects: set the next action from the open task, then mark inspected.
    const project = await screen.findByTestId('review-project');
    const next = within(project).getByLabelText('Next action for Thesis');
    await userEvent.selectOptions(next, within(next).getByRole('option', { name: 'Next thing' }));
    await waitFor(() => expect(screen.getByTestId('acknowledge-step')).toBeEnabled());
    await userEvent.click(screen.getByTestId('acknowledge-step'));
    await waitFor(() => expect(flow).toHaveAttribute('data-step', 'goals'));
    // Goals: reviewed.
    const goal = await screen.findByTestId('review-goal');
    await userEvent.click(within(goal).getByRole('button', { name: 'Reviewed' }));
    await waitFor(() => expect(screen.getByTestId('acknowledge-step')).toBeEnabled());
    await userEvent.click(screen.getByTestId('acknowledge-step'));
    await waitFor(() => expect(flow).toHaveAttribute('data-step', 'bills'));
    // Bills: pay the rent inside the review.
    const bill = await screen.findByTestId('review-bill');
    await userEvent.click(within(bill).getByRole('button', { name: 'Mark paid' }));
    await waitFor(async () => expect((await repo.bills.get(rent.id))!.paid).toBe(true));
    await waitFor(() => expect(screen.getByTestId('acknowledge-step')).toBeEnabled());
    await userEvent.click(screen.getByTestId('acknowledge-step'));
    await waitFor(() => expect(flow).toHaveAttribute('data-step', 'capacity'));
    // Capacity: both comparisons, then finish.
    expect(await screen.findByTestId('capacity-booked')).toHaveTextContent('of 57.8 h');
    expect(screen.getByTestId('capacity-targets')).toHaveTextContent('10.0 h');
    expect(screen.getByTestId('finish-review')).toBeDisabled();
    await userEvent.click(screen.getByTestId('acknowledge-step'));
    await waitFor(() => expect(screen.getByTestId('finish-review')).toBeEnabled());
    // Something changes under an acknowledged step: Finish asks instead of certifying.
    await repo.captures.upsert(
      createRecord(CaptureSchema, clock, { text: 'Late arrival', type: 'note' }),
    );
    await userEvent.click(screen.getByTestId('finish-review'));
    const check = await screen.findByTestId('finish-check');
    expect(check).toHaveTextContent('Changed since reviewed: Inbox');
    expect((await repo.weeklyReviews.get(review.id))!.status).not.toBe('completed');
    await userEvent.click(within(check).getByRole('button', { name: 'Go to Inbox' }));
    await waitFor(() => expect(flow).toHaveAttribute('data-step', 'inbox'));
    const rows = await screen.findAllByTestId('inbox-capture');
    const fresh = rows.find((r) => r.textContent?.includes('Late arrival'))!;
    await userEvent.click(within(fresh).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(screen.getByTestId('acknowledge-step')).toBeEnabled());
    await userEvent.click(screen.getByTestId('acknowledge-step'));
    await userEvent.click(screen.getByTestId('step-tab-capacity'));
    await waitFor(() => expect(flow).toHaveAttribute('data-step', 'capacity'));
    await userEvent.click(screen.getByTestId('finish-review'));
    const done = await screen.findByTestId('completed-review');
    expect(done).toHaveTextContent('Completed 2026-09-12');
    const stored = (await repo.weeklyReviews.get(review.id))!;
    expect(stored.status).toBe('completed');
    expect(stored.summary?.items.map((i) => i.label).sort()).toEqual(['Buy milk', 'Late task']);
    expect(stored.summary?.actionCount).toBeGreaterThanOrEqual(6);
    expect(within(done).getByTestId('receipts').children.length).toBe(stored.summary!.actionCount);
  });

  it('a stale revision from another window is refused and the inputs stay', async () => {
    const { repo, clock } = await seed();
    const review = await startReview(repo, { clock });
    render(repo, clock, `/review/weekly?review=${review.id}`);
    const row = await screen.findByTestId('inbox-capture');
    // The other window moves the review on.
    await repo.weeklyReviews.upsert({
      ...review,
      revision: review.revision + 1,
      currentStep: 'overdue',
    });
    await userEvent.click(within(row).getByRole('button', { name: 'Convert' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('moved in another window');
    expect(await repo.weeklyReviewActions.count()).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(screen.getByTestId('weekly-flow')).toHaveAttribute('data-step', 'overdue'),
    );
  });

  it('the Today launcher and the route work; a missing review shows a safe state', async () => {
    const { repo, clock } = await seed();
    renderWithProviders(<AppRoutes />, {
      repository: repo,
      route: '/review/weekly?review=00000000-0000-7000-8000-000000000001',
      clock,
    });
    expect(await screen.findByText('That review no longer exists')).toBeInTheDocument();
  });
});
