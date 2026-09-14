import type { Clock } from '../clock';
import { nowIso } from '../clock';
import { addDays } from '../dates';
import { newId } from '../ids';
import { computeDayLoad, type DayLoad } from '../insights/dayLoad';
import { fingerprint } from '../insights/fingerprint';
import { fullDayCapacity } from '../insights/capacity';
import type { InsightIndex } from '../insights/snapshot';
import type {
  AreaTargetEvidence,
  CapacityEvidence,
  InsightPlanning,
  InsightSnapshot,
} from '../insights/types';
import { createRecord } from '../records';
import { startOfWeek } from '../recurrence/expand';
import { WEEKLY_REVIEW_STEPS, WeeklyReviewSchema } from '../schema';
import type {
  Id,
  InsightSettings,
  LocalDate,
  ReviewRef,
  Task,
  WeeklyReview,
  WeeklyReviewAction,
  WeeklyReviewStep,
  WeeklyReviewStepDraft,
  WeeklyReviewStepOutcome,
  WeeklyReviewSummary,
} from '../schema';

/**
 * The weekly review's pure rules (week 12): which weeks a review covers,
 * how it moves between steps, what a step's acknowledgement records, and
 * the capacity comparison for the frozen target week. Persistence, receipts,
 * and conflicts live in the application service; nothing here writes.
 */

export const WEEKLY_REVIEW_FLOW_VERSION = 1;

export const STEP_LABEL: Record<WeeklyReviewStep, string> = {
  inbox: 'Inbox',
  overdue: 'Overdue work',
  projects: 'Projects',
  goals: 'Goals and targets',
  bills: 'Bills',
  capacity: 'Next week',
};

export class WeeklyReviewError extends Error {
  constructor(
    public readonly code:
      | 'completed'
      | 'stale-revision'
      | 'invalid-step'
      | 'unknown-step'
      | 'draft-too-large'
      | 'not-finished',
    message: string,
  ) {
    super(message);
    this.name = 'WeeklyReviewError';
  }
}

/** The local week holding `today` and the one after it: what a review started today covers. */
export function reviewWeeksFor(today: LocalDate): {
  reviewWeekStart: LocalDate;
  targetWeekStart: LocalDate;
} {
  const reviewWeekStart = startOfWeek(today);
  return { reviewWeekStart, targetWeekStart: addDays(reviewWeekStart, 7) };
}

export function stepIndex(step: WeeklyReviewStep): number {
  return WEEKLY_REVIEW_STEPS.indexOf(step);
}

export function nextStep(step: WeeklyReviewStep): WeeklyReviewStep | null {
  return WEEKLY_REVIEW_STEPS[stepIndex(step) + 1] ?? null;
}

export function previousStep(step: WeeklyReviewStep): WeeklyReviewStep | null {
  const i = stepIndex(step);
  return i > 0 ? WEEKLY_REVIEW_STEPS[i - 1]! : null;
}

export function stepOutcome(
  review: WeeklyReview,
  step: WeeklyReviewStep,
): WeeklyReviewStepOutcome | undefined {
  return review.steps.find((s) => s.step === step);
}

/** A fresh review of the week holding `today`, at its first step. */
export function newWeeklyReview(clock: Clock, today: LocalDate): WeeklyReview {
  const weeks = reviewWeeksFor(today);
  return createRecord(WeeklyReviewSchema, clock, {
    id: newId(),
    ...weeks,
    flowVersion: WEEKLY_REVIEW_FLOW_VERSION,
    revision: 1,
    status: 'inProgress',
    currentStep: 'inbox',
    steps: [],
    stepDraft: null,
    startedAt: nowIso(clock),
    pausedAt: null,
    completedAt: null,
    summary: null,
  });
}

export function isActiveReview(review: WeeklyReview): boolean {
  return review.deletedAt === null && review.status !== 'completed';
}

/**
 * Among several unfinished reviews (imports can bring duplicates), the one
 * to resume: the newest change wins, then the earliest week, then the
 * smallest id. Every record is preserved; this only picks the candidate.
 */
export function canonicalActiveReview(reviews: readonly WeeklyReview[]): WeeklyReview | null {
  const active = reviews.filter(isActiveReview);
  if (!active.length) return null;
  return [...active].sort(
    (a, b) =>
      (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0) ||
      (a.reviewWeekStart < b.reviewWeekStart
        ? -1
        : a.reviewWeekStart > b.reviewWeekStart
          ? 1
          : 0) ||
      (a.id < b.id ? -1 : 1),
  )[0]!;
}

function assertOpen(review: WeeklyReview): void {
  if (review.status === 'completed')
    throw new WeeklyReviewError('completed', 'This review is finished and read-only.');
}

function bump(review: WeeklyReview, clock: Clock): WeeklyReview {
  return { ...review, revision: review.revision + 1, updatedAt: nowIso(clock) };
}

/** Move to another step without acknowledging anything. Back never reverses committed work. */
export function goToStep(review: WeeklyReview, step: WeeklyReviewStep, clock: Clock): WeeklyReview {
  assertOpen(review);
  if (!WEEKLY_REVIEW_STEPS.includes(step))
    throw new WeeklyReviewError('unknown-step', 'That step does not exist.');
  return bump({ ...review, currentStep: step, status: 'inProgress' }, clock);
}

/**
 * Acknowledge the current step: record what was shown (as a fingerprint)
 * and the counts, then move to the next step. "done" means every item was
 * acted on or acknowledged; "deferred" means some were explicitly left.
 */
export function acknowledgeStep(
  review: WeeklyReview,
  outcome: Omit<WeeklyReviewStepOutcome, 'at' | 'step'> & { step?: WeeklyReviewStep },
  clock: Clock,
): WeeklyReview {
  assertOpen(review);
  const step = outcome.step ?? review.currentStep;
  const record: WeeklyReviewStepOutcome = { ...outcome, step, at: nowIso(clock) };
  const steps = [...review.steps.filter((s) => s.step !== step), record].sort(
    (a, b) => stepIndex(a.step) - stepIndex(b.step),
  );
  const following = nextStep(step);
  return bump(
    {
      ...review,
      steps,
      currentStep: following ?? step,
      stepDraft: review.stepDraft?.step === step ? null : review.stepDraft,
      status: 'inProgress',
    },
    clock,
  );
}

/**
 * Editing an earlier step changes live data: later acknowledgements whose
 * fingerprints no longer match are dropped so Finish asks again. Returns
 * the review and which steps were invalidated.
 */
export function invalidateSteps(
  review: WeeklyReview,
  current: Partial<Record<WeeklyReviewStep, string>>,
  clock: Clock,
): { review: WeeklyReview; invalidated: WeeklyReviewStep[] } {
  const invalidated: WeeklyReviewStep[] = [];
  const steps = review.steps.filter((s) => {
    const now = current[s.step];
    if (now !== undefined && now !== s.fingerprint) {
      invalidated.push(s.step);
      return false;
    }
    return true;
  });
  if (!invalidated.length) return { review, invalidated };
  return { review: bump({ ...review, steps }, clock), invalidated };
}

/** Pause: keep the step, store the validated unsubmitted choices, mark paused. */
export function pauseReview(
  review: WeeklyReview,
  draft: Omit<WeeklyReviewStepDraft, 'version' | 'savedAt'> | null,
  clock: Clock,
): WeeklyReview {
  assertOpen(review);
  if (draft && draft.choices.length > 200)
    throw new WeeklyReviewError('draft-too-large', 'Apply some choices before pausing.');
  return bump(
    {
      ...review,
      status: 'paused',
      pausedAt: nowIso(clock),
      stepDraft: draft ? { version: 1, savedAt: nowIso(clock), ...draft } : null,
    },
    clock,
  );
}

export function resumeReview(review: WeeklyReview, clock: Clock): WeeklyReview {
  assertOpen(review);
  if (review.status === 'inProgress') return review;
  return bump({ ...review, status: 'inProgress' }, clock);
}

/** Drop the saved draft without applying it. */
export function discardDraft(review: WeeklyReview, clock: Clock): WeeklyReview {
  assertOpen(review);
  if (!review.stepDraft) return review;
  return bump({ ...review, stepDraft: null }, clock);
}

/** Finish: every step acknowledged, the summary frozen, the review read-only. */
export function completeReview(
  review: WeeklyReview,
  summary: WeeklyReviewSummary,
  clock: Clock,
): WeeklyReview {
  if (review.status === 'completed') return review;
  const missing = WEEKLY_REVIEW_STEPS.filter((s) => !stepOutcome(review, s));
  if (missing.length)
    throw new WeeklyReviewError(
      'not-finished',
      `Acknowledge ${missing.map((s) => STEP_LABEL[s]).join(', ')} before finishing.`,
    );
  const at = nowIso(clock);
  return bump(
    {
      ...review,
      status: 'completed',
      completedAt: at,
      pausedAt: null,
      stepDraft: null,
      currentStep: 'capacity',
      summary: { ...summary, steps: review.steps },
    },
    clock,
  );
}

/** Whether the stored revision is the one the caller acted on. */
export function assertRevision(review: WeeklyReview, expected: number): void {
  if (review.revision !== expected)
    throw new WeeklyReviewError(
      'stale-revision',
      'This review changed in another window. Refresh to see the latest progress; your input is kept.',
    );
}

// ---------------------------------------------------------------------------
// Subjects and fingerprints
// ---------------------------------------------------------------------------

/** A fingerprint over the identity and change stamp of every subject a step shows. */
export function subjectsFingerprint(
  subjects: ReadonlyArray<{ id: Id; updatedAt: string; deletedAt?: string | null }>,
): string {
  return fingerprint(
    [...subjects]
      .map((s) => [s.id, s.updatedAt, s.deletedAt ?? null])
      .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)),
  );
}

/** One record's fingerprint: what a draft choice or receipt was made against. */
export function recordFingerprint(record: {
  id: Id;
  updatedAt: string;
  deletedAt?: string | null;
}): string {
  return fingerprint([record.id, record.updatedAt, record.deletedAt ?? null]);
}

/** Live unfinished tasks whose deadline passed before `now`. Inbox deadlines count too. */
export function overdueTasks(tasks: readonly Task[], now: Date): Task[] {
  const at = now.toISOString();
  return tasks
    .filter(
      (t) =>
        t.deletedAt === null &&
        (t.status === 'open' || t.status === 'inbox') &&
        t.dueAt !== null &&
        Number.isFinite(new Date(t.dueAt).getTime()) &&
        t.dueAt < at,
    )
    .sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : a.dueAt! > b.dueAt! ? 1 : a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export interface StepTally {
  step: WeeklyReviewStep;
  actions: number;
  deferred: number;
}

/** Compact per-step counts over a review's receipts. */
export function tallyReceipts(actions: readonly WeeklyReviewAction[]): StepTally[] {
  const tallies = new Map<WeeklyReviewStep, StepTally>();
  for (const step of WEEKLY_REVIEW_STEPS) tallies.set(step, { step, actions: 0, deferred: 0 });
  for (const a of actions) {
    if (a.deletedAt !== null) continue;
    const t = tallies.get(a.step)!;
    t.actions += 1;
    if (a.kind === 'defer') t.deferred += 1;
  }
  return [...tallies.values()];
}

/** The refs deferred in a step and not superseded by a later receipt on the same ref. */
export function deferredRefs(
  actions: readonly WeeklyReviewAction[],
  step: WeeklyReviewStep,
): ReviewRef[] {
  const sorted = [...actions]
    .filter((a) => a.deletedAt === null && a.step === step)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  const latest = new Map<string, WeeklyReviewAction>();
  for (const a of sorted) for (const ref of a.refs) latest.set(`${ref.type}:${ref.id}`, a);
  const out: ReviewRef[] = [];
  for (const [key, a] of latest) {
    if (a.kind !== 'defer') continue;
    const [type, id] = key.split(':') as [ReviewRef['type'], Id];
    out.push({ type, id });
  }
  return out;
}

/** Whether a stored receipt is the replay of `submission`. */
export function receiptMatches(
  receipt: WeeklyReviewAction,
  submission: Pick<WeeklyReviewAction, 'reviewId' | 'step' | 'kind' | 'refs' | 'choice'>,
): boolean {
  return (
    receipt.reviewId === submission.reviewId &&
    receipt.step === submission.step &&
    receipt.kind === submission.kind &&
    fingerprint(receipt.refs) === fingerprint(submission.refs) &&
    fingerprint(receipt.choice) === fingerprint(submission.choice)
  );
}

// ---------------------------------------------------------------------------
// Target-week capacity (explicit week, not "next week from now")
// ---------------------------------------------------------------------------

export interface WeekCapacity {
  weekStart: LocalDate;
  weekEnd: LocalDate;
  days: DayLoad[];
  /** Σ committed minutes over the seven days. */
  bookedMin: number;
  /** Σ full-day capacity over the seven days. */
  availableMin: number;
  bookedOverloaded: boolean;
  /** Days over the saved per-day threshold, whatever the weekly total says. */
  overloadedDays: LocalDate[];
  targets: AreaTargetEvidence[];
  targetMin: number;
  targetDeficitMin: number;
  capacities: CapacityEvidence[];
  computedAt: string;
}

/**
 * Two separate comparisons for one explicit week: booked work against
 * available time, and area weekly targets against available time. The
 * two are never added together — booked work may already be fulfilling
 * the targets. Buffers are excluded from both, and neither proves that
 * the hours can be placed under area, energy, or buffer rules.
 */
export function weekCapacity(
  weekStart: LocalDate,
  snapshot: InsightSnapshot,
  index: InsightIndex,
  planning: InsightPlanning,
  settings: Pick<InsightSettings, 'dayOverloadRatio'>,
  computedAt: string,
): WeekCapacity {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const days = dates.map((d) => computeDayLoad(d, snapshot, index, planning, settings));
  const capacities = dates.map((d) =>
    fullDayCapacity(d, planning, snapshot.rules, snapshot.events),
  );
  const bookedMin = days.reduce((sum, d) => sum + d.demandMin, 0);
  const availableMin = capacities.reduce((sum, c) => sum + c.availableMin, 0);
  const targets: AreaTargetEvidence[] = [...index.areaById.values()]
    .filter((a) => a.weeklyHoursTarget > 0)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((a) => ({
      kind: 'area-target',
      ref: { type: 'area', id: a.id },
      name: a.name,
      weeklyHoursTarget: a.weeklyHoursTarget,
      minutes: Math.round(a.weeklyHoursTarget * 60),
    }));
  const targetMin = targets.reduce((sum, t) => sum + t.minutes, 0);
  return {
    weekStart,
    weekEnd: dates[6]!,
    days,
    bookedMin,
    availableMin,
    bookedOverloaded: bookedMin > availableMin,
    overloadedDays: days.filter((d) => d.overloaded).map((d) => d.date),
    targets,
    targetMin,
    targetDeficitMin: Math.max(0, targetMin - availableMin),
    capacities,
    computedAt,
  };
}

/** The frozen summary block for the capacity step. */
export function capacitySummary(week: WeekCapacity): NonNullable<WeeklyReviewSummary['capacity']> {
  return {
    bookedMin: week.bookedMin,
    availableMin: week.availableMin,
    targetMin: week.targetMin,
    overloadedDays: week.overloadedDays.length,
    computedAt: week.computedAt,
  };
}
