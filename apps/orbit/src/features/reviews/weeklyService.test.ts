import { describe, expect, it } from 'vitest';
import {
  AreaSchema,
  BlockSchema,
  CaptureSchema,
  GoalSchema,
  ProjectSchema,
  RuleSchema,
  TaskSchema,
  createRecord,
  fixedClock,
  newId,
} from '@orbit/core';
import type { FixedClock, WeeklyReview } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import type { Repository } from '@orbit/storage';
import { createBill } from '@/features/bills/billsService';
import {
  acknowledge,
  archiveTaskWithin,
  checkFinish,
  convertCaptureWithin,
  createNextActionWithin,
  currentFingerprints,
  finishReview,
  goToStep,
  loadBillsStep,
  loadCapacityStep,
  loadInboxStep,
  loadLanding,
  loadOverdueStep,
  loadProjectsStep,
  loadReceipts,
  pauseReview,
  payBillWithin,
  rescheduleTaskWithin,
  resumeReview,
  setNextActionWithin,
  startReview,
  submitAction,
} from './weeklyService';

const fresh = (): FixedClock => fixedClock(new Date(2026, 8, 12, 9, 0, 0)); // Sat 12 Sep 2026 local
const outcome = {
  status: 'done' as const,
  fingerprint: 'x',
  resolved: 0,
  deferred: 0,
  remaining: 0,
  reason: '',
};

async function world(repo: Repository, clock: FixedClock) {
  const area = await repo.areas.upsert(
    createRecord(AreaSchema, clock, { name: 'Study', weeklyHoursTarget: 10 }),
  );
  const project = await repo.projects.upsert(
    createRecord(ProjectSchema, clock, { title: 'Thesis', areaId: area.id }),
  );
  const goal = await repo.goals.upsert(
    createRecord(GoalSchema, clock, { title: 'Graduate', areaId: area.id }),
  );
  const overdue = await repo.tasks.upsert(
    createRecord(TaskSchema, clock, {
      title: 'Late task',
      status: 'open',
      projectId: project.id,
      areaId: area.id,
      dueAt: '2026-09-10T09:00:00.000Z',
    }),
  );
  const open = await repo.tasks.upsert(
    createRecord(TaskSchema, clock, {
      title: 'Next',
      status: 'open',
      projectId: project.id,
      areaId: area.id,
    }),
  );
  const inboxTask = await repo.tasks.upsert(
    createRecord(TaskSchema, clock, { title: 'Untriaged', status: 'inbox' }),
  );
  const capture = await repo.captures.upsert(
    createRecord(CaptureSchema, clock, { text: 'Buy milk', type: 'task' }),
  );
  await repo.rules.upsert(
    createRecord(RuleSchema, clock, {
      type: 'reminder',
      name: 'Bills',
      config: { kind: 'billDueWithin', days: 3 },
    }),
  );
  const rent = await createBill(
    repo,
    {
      title: 'Rent',
      amount: 900,
      currency: 'USD',
      dueAt: '2026-09-16',
      recurrence: {
        freq: 'monthly',
        interval: 1,
        byDay: [],
        byMonthDay: null,
        count: null,
        until: null,
      },
    },
    clock,
  );
  return { area, project, goal, overdue, open, inboxTask, capture, rent };
}

describe('weekly review service', () => {
  it('starts once per week, resumes on a second start, and freezes the periods across a Monday rollover', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const a = await startReview(repo, { clock });
    expect(a).toMatchObject({
      reviewWeekStart: '2026-09-07',
      targetWeekStart: '2026-09-14',
      status: 'inProgress',
      currentStep: 'inbox',
    });
    const b = await startReview(repo, { clock });
    expect(b.id).toBe(a.id);
    // Pause with a draft, then the week turns over: the same review resumes with its periods.
    const paused = await pauseReview(
      repo,
      a.id,
      b.revision,
      { step: 'overdue', choices: [] },
      clock,
    );
    expect(paused.status).toBe('paused');
    clock.advance(3 * 86_400_000); // Tuesday 15 Sep
    const landing = await loadLanding(repo, clock);
    expect(landing.active?.id).toBe(a.id);
    expect(landing.thisWeek).toEqual({
      reviewWeekStart: '2026-09-14',
      targetWeekStart: '2026-09-21',
    });
    const resumed = await resumeReview(repo, a.id, clock);
    expect(resumed).toMatchObject({
      reviewWeekStart: '2026-09-07',
      targetWeekStart: '2026-09-14',
      status: 'inProgress',
      currentStep: 'inbox',
    });
    expect(resumed.stepDraft?.step).toBe('overdue');
    // "Start this week" is explicit and leaves the older one alone.
    const fresh2 = await startReview(repo, { clock, startNew: true });
    expect(fresh2.id).not.toBe(a.id);
    expect((await loadLanding(repo, clock)).others.length + 1).toBe(2);
  });

  it('receipts are idempotent by action id and refuse reuse for a different payload', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const { capture } = await world(repo, clock);
    const review = await startReview(repo, { clock });
    const actionId = newId();
    const submission = {
      reviewId: review.id,
      revision: review.revision,
      actionId,
      step: 'inbox' as const,
      kind: 'convert-capture' as const,
      refs: [{ type: 'capture' as const, id: capture.id }],
      fingerprint: 'f',
      choice: { type: 'task' },
    };
    const first = await submitAction(
      repo,
      submission,
      (tx) => convertCaptureWithin(tx, capture.id, { type: 'task' }, clock),
      clock,
    );
    expect(first.replayed).toBe(false);
    expect(first.review.revision).toBe(review.revision + 1);
    const milk = async () => (await repo.tasks.query((t) => t.title === 'Buy milk')).length;
    expect(await milk()).toBe(1);
    // Retry with the same id (even with a stale revision): the stored result, no second task.
    const again = await submitAction(
      repo,
      submission,
      () => {
        throw new Error('must not run');
      },
      clock,
    );
    expect(again.replayed).toBe(true);
    expect(again.result).toEqual(first.result);
    expect(await milk()).toBe(1);
    // A new id for the already-processed capture returns the original reference too.
    const other = await submitAction(
      repo,
      { ...submission, actionId: newId(), revision: first.review.revision },
      (tx) => convertCaptureWithin(tx, capture.id, { type: 'task' }, clock),
      clock,
    );
    expect(other.result).toMatchObject({ id: first.result.id, replayed: true });
    expect(await milk()).toBe(1);
    // The same id for a different payload is an error, not a replay.
    await expect(
      submitAction(
        repo,
        { ...submission, kind: 'archive-capture', choice: {} },
        async () => ({}),
        clock,
      ),
    ).rejects.toThrow(/already used/);
    // A stale revision is refused before anything runs.
    await expect(
      submitAction(
        repo,
        { ...submission, actionId: newId(), revision: 1 },
        async () => {
          throw new Error('must not run');
        },
        clock,
      ),
    ).rejects.toThrow(/another window/);
  });

  it('a failure between the entity mutation and the receipt leaves neither', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const { overdue } = await world(repo, clock);
    const review = await startReview(repo, { clock });
    await expect(
      submitAction(
        repo,
        {
          reviewId: review.id,
          revision: review.revision,
          actionId: newId(),
          step: 'overdue',
          kind: 'archive-task',
          refs: [{ type: 'task', id: overdue.id }],
          fingerprint: 'f',
          choice: {},
        },
        async (tx) => {
          await archiveTaskWithin(tx, overdue.id);
          throw new Error('receipt failed');
        },
        clock,
      ),
    ).rejects.toThrow('receipt failed');
    expect((await repo.tasks.get(overdue.id))!.status).toBe('open');
    expect(await repo.weeklyReviewActions.count()).toBe(0);
    expect((await repo.weeklyReviews.get(review.id))!.revision).toBe(review.revision);
  });

  it('overdue choices are recorded; a reschedule says which blocks stayed put', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const { overdue, project } = await world(repo, clock);
    await repo.blocks.upsert(
      createRecord(BlockSchema, clock, {
        date: '2026-09-10',
        startMin: 540,
        endMin: 600,
        taskId: overdue.id,
        locked: true,
        source: 'manual',
      }),
    );
    const step = await loadOverdueStep(repo, clock);
    expect(step.tasks.map((t) => t.task.id)).toEqual([overdue.id]);
    expect(step.tasks[0]!.blocks).toHaveLength(1);
    expect(step.tasks[0]!.project?.id).toBe(project.id);
    const review = await startReview(repo, { clock });
    const result = await submitAction(
      repo,
      {
        reviewId: review.id,
        revision: review.revision,
        actionId: newId(),
        step: 'overdue',
        kind: 'reschedule-task',
        refs: [{ type: 'task', id: overdue.id }],
        fingerprint: step.fingerprint,
        choice: { dueAt: '2026-09-20T09:00:00.000Z' },
      },
      (tx) => rescheduleTaskWithin(tx, overdue.id, '2026-09-20T09:00:00.000Z'),
      clock,
    );
    expect(result.result).toEqual({ dueAt: '2026-09-20T09:00:00.000Z', blocksLeftOnOldDates: 1 });
    expect((await repo.blocks.list())[0]!.date).toBe('2026-09-10');
    expect((await loadOverdueStep(repo, clock)).tasks).toHaveLength(0);
    const receipts = await loadReceipts(repo, review.id);
    expect(receipts.total).toBe(1);
    expect(receipts.rows[0]!.kind).toBe('reschedule-task');
  });

  it('next actions are revalidated at save time and health updates after the commit', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const { project, open, inboxTask } = await world(repo, clock);
    const before = await loadProjectsStep(repo, clock);
    expect(before.projects[0]!.health.noNextAction).toBe(true);
    const review = await startReview(repo, { clock });
    await expect(
      submitAction(
        repo,
        {
          reviewId: review.id,
          revision: review.revision,
          actionId: newId(),
          step: 'projects',
          kind: 'set-next-action',
          refs: [{ type: 'project', id: project.id }],
          fingerprint: before.fingerprint,
          choice: { taskId: inboxTask.id },
        },
        (tx) => setNextActionWithin(tx, project.id, inboxTask.id),
        clock,
      ),
    ).rejects.toThrow(/another project/);
    const ok = await submitAction(
      repo,
      {
        reviewId: review.id,
        revision: review.revision,
        actionId: newId(),
        step: 'projects',
        kind: 'set-next-action',
        refs: [{ type: 'project', id: project.id }],
        fingerprint: before.fingerprint,
        choice: { taskId: open.id },
      },
      (tx) => setNextActionWithin(tx, project.id, open.id),
      clock,
    );
    expect((await loadProjectsStep(repo, clock)).projects[0]!.health.noNextAction).toBe(false);
    const created = await submitAction(
      repo,
      {
        reviewId: review.id,
        revision: ok.review.revision,
        actionId: newId(),
        step: 'projects',
        kind: 'create-next-action',
        refs: [{ type: 'project', id: project.id }],
        fingerprint: before.fingerprint,
        choice: { title: 'Write intro' },
      },
      (tx) => createNextActionWithin(tx, project.id, 'Write intro', clock),
      clock,
    );
    expect((await repo.projects.get(project.id))!.nextActionTaskId).toBe(created.result.taskId);
  });

  it('bills in scope include late successors; payment inside the review is atomic and replayable', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const { rent } = await world(repo, clock);
    const review = await startReview(repo, { clock });
    const step = await loadBillsStep(repo, review, clock);
    expect(step.periodEnd).toBe('2026-09-20');
    expect(step.due.map((b) => b.id)).toEqual([rent.id]);
    const actionId = newId();
    const paid = await submitAction(
      repo,
      {
        reviewId: review.id,
        revision: review.revision,
        actionId,
        step: 'bills',
        kind: 'pay-bill',
        refs: [{ type: 'bill', id: rent.id }],
        fingerprint: step.fingerprint,
        choice: { paidAt: '2026-09-12T10:00:00.000Z' },
      },
      (tx) => payBillWithin(tx, rent.id, '2026-09-12T10:00:00.000Z', clock),
      clock,
    );
    expect(paid.result).toMatchObject({
      plan: 'next',
      successorDueAt: '2026-10-16',
      replayed: false,
    });
    expect(await repo.bills.count()).toBe(2);
    const replay = await submitAction(
      repo,
      {
        reviewId: review.id,
        revision: 0,
        actionId,
        step: 'bills',
        kind: 'pay-bill',
        refs: [{ type: 'bill', id: rent.id }],
        fingerprint: step.fingerprint,
        choice: { paidAt: '2026-09-12T10:00:00.000Z' },
      },
      () => {
        throw new Error('no');
      },
      clock,
    );
    expect(replay.replayed).toBe(true);
    expect(await repo.bills.count()).toBe(2);
    // The successor (October) is outside this period; a late one would show up.
    expect((await loadBillsStep(repo, paid.review, clock)).due).toHaveLength(0);
  });

  it('capacity uses the frozen target week with booked and target comparisons kept apart', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const { open } = await world(repo, clock);
    for (let i = 0; i < 10; i++)
      await repo.blocks.upsert(
        createRecord(BlockSchema, clock, {
          date: '2026-09-15',
          startMin: 540 + i * 60,
          endMin: 600 + i * 60,
          taskId: open.id,
          source: 'manual',
        }),
      );
    const review = await startReview(repo, { clock });
    const step = await loadCapacityStep(repo, review, clock);
    expect(step.week.weekStart).toBe('2026-09-14');
    expect(step.week.bookedMin).toBe(600);
    expect(step.week.overloadedDays).toEqual(['2026-09-15']);
    expect(step.week.bookedOverloaded).toBe(false);
    expect(step.week.targetMin).toBe(600);
    expect(step.week.targetDeficitMin).toBe(0);
    // Resumed weeks later, the same target week is computed, not "next week from now".
    clock.advance(21 * 86_400_000);
    expect((await loadCapacityStep(repo, review, clock)).week.weekStart).toBe('2026-09-14');
  });

  it('finish rechecks fingerprints, requires every step, freezes a summary, and is idempotent', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const { capture } = await world(repo, clock);
    let review: WeeklyReview = await startReview(repo, { clock });
    const prints = await currentFingerprints(repo, review, clock);
    for (const step of ['inbox', 'overdue', 'projects', 'goals', 'bills'] as const) {
      review = await acknowledge(
        repo,
        review.id,
        review.revision,
        { ...outcome, step, fingerprint: prints[step] },
        clock,
      );
    }
    // Five of six acknowledged: Finish reports the missing one and completes nothing.
    let attempt = await finishReview(repo, review.id, review.revision, clock);
    expect(attempt.review.status).toBe('inProgress');
    expect(attempt.check.missing).toEqual(['patterns', 'capacity']);
    review = await acknowledge(
      repo,
      review.id,
      review.revision,
      { ...outcome, step: 'patterns', fingerprint: prints.patterns },
      clock,
    );
    review = await acknowledge(
      repo,
      review.id,
      review.revision,
      { ...outcome, step: 'capacity', fingerprint: prints.capacity },
      clock,
    );
    // A source changes under an acknowledged step: Finish asks again rather than certifying.
    await repo.captures.upsert({ ...capture, status: 'archived' });
    attempt = await finishReview(repo, review.id, review.revision, clock);
    expect(attempt.check.changed).toEqual(['inbox']);
    expect(attempt.review.status).toBe('inProgress');
    const again = await currentFingerprints(repo, review, clock);
    review = await goToStep(repo, review.id, review.revision, 'inbox', clock);
    review = await acknowledge(
      repo,
      review.id,
      review.revision,
      { ...outcome, step: 'inbox', fingerprint: again.inbox },
      clock,
    );
    const check = await checkFinish(repo, review, clock);
    expect(check.changed).toEqual([]);
    const done = await finishReview(repo, review.id, review.revision, clock);
    expect(done.review.status).toBe('completed');
    expect(done.review.summary).toMatchObject({
      reviewWeekStart: '2026-09-07',
      targetWeekStart: '2026-09-14',
      actionCount: 0,
    });
    expect(done.review.summary?.capacity?.targetMin).toBe(600);
    // Repeated Finish returns the same record; the summary does not move with tomorrow's data.
    const twice = await finishReview(repo, review.id, done.review.revision, clock);
    expect(twice.review).toEqual(done.review);
    await expect(
      acknowledge(repo, review.id, done.review.revision, { ...outcome, step: 'inbox' }, clock),
    ).rejects.toThrow(/read-only/);
    const landing = await loadLanding(repo, clock);
    expect(landing.completed.map((r) => r.id)).toEqual([review.id]);
    expect(landing.active).toBeNull();
    const inbox = await loadInboxStep(repo);
    expect(inbox.captures).toHaveLength(0);
  });
});
