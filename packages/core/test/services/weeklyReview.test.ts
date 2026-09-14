import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/clock';
import { DEFAULT_INSIGHT_SETTINGS, buildInsightIndex } from '../../src/insights';
import { createRecord } from '../../src/records';
import { WEEKLY_REVIEW_STEPS, WeeklyReviewActionSchema } from '../../src/schema';
import type { WeeklyReview } from '../../src/schema';
import {
  WeeklyReviewError,
  acknowledgeStep,
  assertRevision,
  canonicalActiveReview,
  capacitySummary,
  completeReview,
  deferredRefs,
  discardDraft,
  goToStep,
  invalidateSteps,
  newWeeklyReview,
  nextStep,
  overdueTasks,
  pauseReview,
  previousStep,
  receiptMatches,
  recordFingerprint,
  resumeReview,
  reviewWeeksFor,
  subjectsFingerprint,
  tallyReceipts,
  weekCapacity,
} from '../../src/services/weeklyReview';
import { aBlock, aTask, anArea, testClock } from '../builders';
import { PLANNING, snapshotWith } from '../insights/helpers';

const clock = testClock(); // Sat 12 Sep 2026 09:00 local
const TODAY = '2026-09-12';

function start(): WeeklyReview {
  return newWeeklyReview(clock, TODAY);
}

describe('review periods and steps', () => {
  it('freezes the local week and the following Monday, whatever day the review starts', () => {
    expect(reviewWeeksFor('2026-09-12')).toEqual({
      reviewWeekStart: '2026-09-07',
      targetWeekStart: '2026-09-14',
    });
    expect(reviewWeeksFor('2026-09-13')).toEqual({
      reviewWeekStart: '2026-09-07',
      targetWeekStart: '2026-09-14',
    });
    expect(reviewWeeksFor('2026-09-14')).toEqual({
      reviewWeekStart: '2026-09-14',
      targetWeekStart: '2026-09-21',
    });
    const review = start();
    expect(review).toMatchObject({
      reviewWeekStart: '2026-09-07',
      targetWeekStart: '2026-09-14',
      status: 'inProgress',
      currentStep: 'inbox',
      revision: 1,
    });
  });

  it('walks the six steps by identifier', () => {
    expect(WEEKLY_REVIEW_STEPS).toEqual([
      'inbox',
      'overdue',
      'projects',
      'goals',
      'bills',
      'capacity',
    ]);
    expect(nextStep('inbox')).toBe('overdue');
    expect(nextStep('capacity')).toBeNull();
    expect(previousStep('inbox')).toBeNull();
    expect(previousStep('bills')).toBe('goals');
  });
});

describe('acknowledging, pausing, resuming, finishing', () => {
  const outcome = {
    status: 'done' as const,
    fingerprint: 'abc',
    resolved: 2,
    deferred: 0,
    remaining: 0,
    reason: '',
  };

  it('records the step outcome, advances, and bumps the revision', () => {
    const r1 = acknowledgeStep(start(), outcome, clock);
    expect(r1.currentStep).toBe('overdue');
    expect(r1.revision).toBe(2);
    expect(r1.steps).toEqual([{ ...outcome, step: 'inbox', at: clock.now().toISOString() }]);
    // Re-acknowledging a step replaces its outcome instead of duplicating it.
    const r2 = acknowledgeStep(goToStep(r1, 'inbox', clock), { ...outcome, resolved: 5 }, clock);
    expect(r2.steps).toHaveLength(1);
    expect(r2.steps[0]!.resolved).toBe(5);
  });

  it('pause keeps the step and stores the draft; resume restores in-progress without applying it', () => {
    const r1 = acknowledgeStep(start(), outcome, clock);
    const paused = pauseReview(
      r1,
      {
        step: 'overdue',
        choices: [
          { ref: { type: 'task', id: r1.id }, baseFingerprint: 'x', choice: { action: 'defer' } },
        ],
      },
      clock,
    );
    expect(paused).toMatchObject({ status: 'paused', currentStep: 'overdue' });
    expect(paused.pausedAt).toBe(clock.now().toISOString());
    expect(paused.stepDraft?.choices).toHaveLength(1);
    expect(paused.steps).toHaveLength(1);
    const resumed = resumeReview(paused, clock);
    expect(resumed.status).toBe('inProgress');
    expect(resumed.stepDraft).toEqual(paused.stepDraft);
    expect(discardDraft(resumed, clock).stepDraft).toBeNull();
    // A draft belongs to its step: acknowledging that step clears it.
    expect(acknowledgeStep(resumed, outcome, clock).stepDraft).toBeNull();
    expect(() =>
      pauseReview(
        r1,
        {
          step: 'overdue',
          choices: Array.from({ length: 201 }, () => ({
            ref: { type: 'task' as const, id: r1.id },
            baseFingerprint: '',
            choice: {},
          })),
        },
        clock,
      ),
    ).toThrow(WeeklyReviewError);
  });

  it('finishing requires every step and makes the review read-only', () => {
    let review = start();
    expect(() => completeReview(review, summaryFor(review), clock)).toThrow(/Acknowledge/);
    for (const step of WEEKLY_REVIEW_STEPS)
      review = acknowledgeStep(review, { ...outcome, step }, clock);
    const done = completeReview(review, summaryFor(review), clock);
    expect(done).toMatchObject({ status: 'completed', currentStep: 'capacity', stepDraft: null });
    expect(done.completedAt).toBe(clock.now().toISOString());
    expect(done.summary?.steps).toHaveLength(6);
    expect(completeReview(done, summaryFor(done), clock)).toBe(done);
    expect(() => acknowledgeStep(done, outcome, clock)).toThrow(/read-only/);
    expect(() => goToStep(done, 'inbox', clock)).toThrow(/read-only/);
    expect(() => pauseReview(done, null, clock)).toThrow(/read-only/);
  });

  it('a changed source invalidates only the acknowledgements whose fingerprints moved', () => {
    let review = start();
    review = acknowledgeStep(review, { ...outcome, step: 'inbox', fingerprint: 'a' }, clock);
    review = acknowledgeStep(review, { ...outcome, step: 'overdue', fingerprint: 'b' }, clock);
    const { review: next, invalidated } = invalidateSteps(
      review,
      { inbox: 'a', overdue: 'changed' },
      clock,
    );
    expect(invalidated).toEqual(['overdue']);
    expect(next.steps.map((s) => s.step)).toEqual(['inbox']);
    expect(invalidateSteps(next, { inbox: 'a' }, clock).review).toBe(next);
  });

  it('a stale revision is refused with the input preserved', () => {
    const review = start();
    expect(() => assertRevision(review, 1)).not.toThrow();
    expect(() => assertRevision(review, 2)).toThrow(/another window/);
  });

  it('chooses one canonical active review among duplicates without discarding any', () => {
    const a = start();
    const b = { ...start(), updatedAt: '2026-09-12T10:00:00.000Z' };
    const c = { ...start(), status: 'completed' as const, completedAt: clock.now().toISOString() };
    expect(canonicalActiveReview([a, c, b])?.id).toBe(b.id);
    expect(canonicalActiveReview([c])).toBeNull();
  });
});

function summaryFor(review: WeeklyReview) {
  return {
    version: 1 as const,
    reviewWeekStart: review.reviewWeekStart,
    targetWeekStart: review.targetWeekStart,
    computedAt: clock.now().toISOString(),
    steps: [],
    actionCount: 0,
    items: [],
    capacity: null,
  };
}

describe('subjects, receipts, and overdue work', () => {
  it('fingerprints subjects by identity and change stamp, order-independent', () => {
    const a = aTask({}, clock);
    const b = aTask({}, clock);
    expect(subjectsFingerprint([a, b])).toBe(subjectsFingerprint([b, a]));
    expect(subjectsFingerprint([a])).not.toBe(
      subjectsFingerprint([{ ...a, updatedAt: '2026-09-13T00:00:00.000Z' }]),
    );
    expect(recordFingerprint(a)).not.toBe(
      recordFingerprint({ ...a, deletedAt: '2026-09-13T00:00:00.000Z' }),
    );
  });

  it('overdue means live, unfinished, with a valid deadline before now', () => {
    const now = new Date(2026, 8, 12, 9, 0, 0);
    const late = aTask({ dueAt: '2026-09-10T09:00:00.000Z' }, clock);
    const later = aTask({ dueAt: '2026-09-11T09:00:00.000Z', status: 'inbox' }, clock);
    const future = aTask({ dueAt: '2026-09-20T09:00:00.000Z' }, clock);
    const done = aTask({ dueAt: '2026-09-01T09:00:00.000Z', status: 'done' }, clock);
    const gone = {
      ...aTask({ dueAt: '2026-09-01T09:00:00.000Z' }, clock),
      deletedAt: clock.now().toISOString(),
    };
    expect(overdueTasks([future, later, done, late, gone], now).map((t) => t.id)).toEqual([
      late.id,
      later.id,
    ]);
  });

  it('tallies receipts per step and finds refs still deferred', () => {
    const review = start();
    const task = aTask({}, clock);
    const receipt = (kind: 'defer' | 'reschedule-task', at: string) =>
      createRecord(WeeklyReviewActionSchema, fixedClock(at), {
        reviewId: review.id,
        step: 'overdue',
        kind,
        refs: [{ type: 'task', id: task.id }],
        choice: kind === 'defer' ? { reason: 'later' } : { dueAt: '2026-09-20' },
        at,
      });
    const deferred = receipt('defer', '2026-09-12T09:00:00.000Z');
    expect(tallyReceipts([deferred])).toContainEqual({ step: 'overdue', actions: 1, deferred: 1 });
    expect(deferredRefs([deferred], 'overdue')).toEqual([{ type: 'task', id: task.id }]);
    // A later decision on the same ref supersedes the deferral.
    const rescheduled = receipt('reschedule-task', '2026-09-12T10:00:00.000Z');
    expect(deferredRefs([deferred, rescheduled], 'overdue')).toEqual([]);
    expect(
      receiptMatches(deferred, {
        reviewId: review.id,
        step: 'overdue',
        kind: 'defer',
        refs: deferred.refs,
        choice: { reason: 'later' },
      }),
    ).toBe(true);
    expect(
      receiptMatches(deferred, {
        reviewId: review.id,
        step: 'overdue',
        kind: 'defer',
        refs: deferred.refs,
        choice: { reason: 'other' },
      }),
    ).toBe(false);
    expect(receiptMatches(deferred, { ...deferred, reviewId: task.id })).toBe(false);
  });
});

describe('target-week capacity', () => {
  it('keeps booked work and area targets as separate comparisons over the explicit week', () => {
    const area = anArea({ name: 'Study', weeklyHoursTarget: 40 }, clock);
    const task = aTask({ estimateMin: 60 }, clock);
    // Monday 21 Sep: 600 booked minutes on a 495-minute day.
    const blocks = Array.from({ length: 10 }, (_, i) =>
      aBlock(
        { date: '2026-09-21', startMin: 540 + i * 60, endMin: 600 + i * 60, taskId: task.id },
        clock,
      ),
    );
    const snapshot = snapshotWith({ areas: [area], tasks: [task], blocks });
    const index = buildInsightIndex(snapshot, clock.now());
    const week = weekCapacity(
      '2026-09-21',
      snapshot,
      index,
      PLANNING,
      DEFAULT_INSIGHT_SETTINGS,
      clock.now().toISOString(),
    );
    expect(week.weekEnd).toBe('2026-09-27');
    expect(week.days).toHaveLength(7);
    expect(week.availableMin).toBe(495 * 7);
    expect(week.bookedMin).toBe(600);
    expect(week.bookedOverloaded).toBe(false);
    // The weekly total fits; the Monday alone is over 110%.
    expect(week.overloadedDays).toEqual(['2026-09-21']);
    expect(week.targetMin).toBe(2400);
    expect(week.targetDeficitMin).toBe(0);
    const deficit = weekCapacity(
      '2026-09-21',
      snapshotWith({ areas: [{ ...area, weeklyHoursTarget: 80 }] }),
      buildInsightIndex(snapshotWith({ areas: [{ ...area, weeklyHoursTarget: 80 }] }), clock.now()),
      PLANNING,
      DEFAULT_INSIGHT_SETTINGS,
      clock.now().toISOString(),
    );
    expect(deficit.targetDeficitMin).toBe(4800 - 3465);
    expect(capacitySummary(week)).toEqual({
      bookedMin: 600,
      availableMin: 3465,
      targetMin: 2400,
      overloadedDays: 1,
      computedAt: clock.now().toISOString(),
    });
  });
});
