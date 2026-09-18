import {
  TaskSchema,
  WEEKLY_REVIEW_STEPS,
  WeeklyReviewActionSchema,
  WeeklyReviewError,
  acknowledgeStep,
  archiveProjectCascade,
  assertRevision,
  buildInsightIndex,
  buildWeeklyTrendReport,
  canonicalActiveReview,
  capacitySummary,
  completeReview,
  completeTask as completeTaskRule,
  computeGoalAttention,
  computeProjectHealth,
  buildProjectActivity,
  buildProjectHealthIndex,
  createRecord,
  deferredRefs,
  discardDraft,
  goToStep as goToStepRule,
  groupBills,
  insightInputsFor,
  isActiveReview,
  materializeCapture,
  newId,
  newWeeklyReview,
  overdueTasks,
  pauseReview as pauseReviewRule,
  receiptMatches,
  resolveTaskParent,
  resumeReview as resumeReviewRule,
  reviewWeeksFor,
  stopSession,
  subjectsFingerprint,
  systemClock,
  toLocalDate,
  weekCapacity,
} from '@orbit/core';
import type {
  Area,
  Bill,
  Capture,
  CaptureType,
  Clock,
  Goal,
  GoalAttention,
  Id,
  Instant,
  Person,
  Project,
  ProjectHealth,
  ReviewRef,
  Task,
  WeekCapacity,
  WeeklyTrendReport,
  WeeklyReview,
  WeeklyReviewAction,
  WeeklyReviewActionKind,
  WeeklyReviewStep,
  WeeklyReviewStepDraft,
  WeeklyReviewStepOutcome,
  WeeklyReviewSummary,
} from '@orbit/core';
import type { EntityStore, Repository } from '@orbit/storage';
import { currentRecord, mergePatch, mutate } from '@/data/mutations';
import { payWithin, type PaymentOutcome } from '@/features/bills/billsService';
import { captureFields } from '@/features/inbox/inboxService';
import { loadInsightSnapshot } from '@/features/insights/insightService';
import { reconcileReminderQueue } from '@/features/reminders/reminderService';
import { readSettings } from '@/features/settings/settingsService';
import type { BaseRecord } from '@orbit/core';

/**
 * The weekly review's application service (week 12). Persistence, receipts,
 * and conflicts live here; the pure rules are in core. Every submission
 * re-reads the review and the records it concerns inside one owned
 * transaction, performs the domain change, appends the receipt, and bumps
 * the review's revision — together or not at all. A repeated submission
 * with the same action id replays the stored result.
 */

// ---------------------------------------------------------------------------
// Landing, lifecycle
// ---------------------------------------------------------------------------

export interface WeeklyLanding {
  /** The unfinished review to resume, if any (the canonical one among duplicates). */
  active: WeeklyReview | null;
  /** Other unfinished reviews (an import brought duplicates); never merged silently. */
  others: WeeklyReview[];
  /** Completed reviews, newest first. */
  completed: WeeklyReview[];
  thisWeek: { reviewWeekStart: string; targetWeekStart: string };
}

export async function loadLanding(
  repo: Repository,
  clock: Clock = systemClock,
): Promise<WeeklyLanding> {
  const reviews = await repo.weeklyReviews.list();
  const active = canonicalActiveReview(reviews);
  return {
    active,
    others: reviews.filter((r) => isActiveReview(r) && r.id !== active?.id),
    completed: reviews
      .filter((r) => r.status === 'completed')
      .sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : -1)),
    thisWeek: reviewWeeksFor(toLocalDate(clock.now())),
  };
}

/**
 * Start-or-resume, serialized: inside the transaction an unfinished review
 * of the current week is resumed rather than duplicated. `startNew` is the
 * explicit "Review again": a fresh record beside the completed one.
 */
export async function startReview(
  repo: Repository,
  options: { startNew?: boolean; clock?: Clock } = {},
): Promise<WeeklyReview> {
  const clock = options.clock ?? systemClock;
  return mutate(repo, async (tx) => {
    const today = toLocalDate(clock.now());
    const weeks = reviewWeeksFor(today);
    if (!options.startNew) {
      const existing = canonicalActiveReview(
        (await tx.weeklyReviews.list()).filter((r) => r.reviewWeekStart === weeks.reviewWeekStart),
      );
      if (existing) return tx.weeklyReviews.upsert(resumeReviewRule(existing, clock));
    }
    return tx.weeklyReviews.upsert(newWeeklyReview(clock, today));
  });
}

export async function loadReview(repo: Repository, id: Id): Promise<WeeklyReview | null> {
  return (await repo.weeklyReviews.get(id)) ?? null;
}

/** The review at the expected revision, as a promise chain (see `currentRecord`). */
function currentReview(tx: Repository, id: Id, revision: number): Promise<WeeklyReview> {
  return currentRecord(tx.weeklyReviews, { id }, { noun: 'weekly review' }).then((review) => {
    assertRevision(review, revision);
    return review;
  });
}

export async function resumeReview(
  repo: Repository,
  id: Id,
  clock: Clock = systemClock,
): Promise<WeeklyReview> {
  return mutate(repo, async (tx) => {
    const review = await currentRecord(tx.weeklyReviews, { id }, { noun: 'weekly review' });
    return tx.weeklyReviews.upsert(resumeReviewRule(review, clock));
  });
}

export async function pauseReview(
  repo: Repository,
  id: Id,
  revision: number,
  draft: Omit<WeeklyReviewStepDraft, 'version' | 'savedAt'> | null,
  clock: Clock = systemClock,
): Promise<WeeklyReview> {
  return mutate(repo, async (tx) =>
    tx.weeklyReviews.upsert(pauseReviewRule(await currentReview(tx, id, revision), draft, clock)),
  );
}

export async function goToStep(
  repo: Repository,
  id: Id,
  revision: number,
  step: WeeklyReviewStep,
  clock: Clock = systemClock,
): Promise<WeeklyReview> {
  return mutate(repo, async (tx) =>
    tx.weeklyReviews.upsert(goToStepRule(await currentReview(tx, id, revision), step, clock)),
  );
}

export async function dropDraft(
  repo: Repository,
  id: Id,
  revision: number,
  clock: Clock = systemClock,
) {
  return mutate(repo, async (tx) =>
    tx.weeklyReviews.upsert(discardDraft(await currentReview(tx, id, revision), clock)),
  );
}

/** Record the step's outcome and move on. */
export async function acknowledge(
  repo: Repository,
  id: Id,
  revision: number,
  outcome: Omit<WeeklyReviewStepOutcome, 'at' | 'step'> & { step?: WeeklyReviewStep },
  clock: Clock = systemClock,
): Promise<WeeklyReview> {
  return mutate(repo, async (tx) =>
    tx.weeklyReviews.upsert(acknowledgeStep(await currentReview(tx, id, revision), outcome, clock)),
  );
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export interface Submission {
  reviewId: Id;
  revision: number;
  /** Generated when the user submits; reused when the same request is retried. */
  actionId: Id;
  step: WeeklyReviewStep;
  kind: WeeklyReviewActionKind;
  refs: ReviewRef[];
  /** Fingerprint of the reviewed sources at submission. */
  fingerprint: string;
  choice: Record<string, unknown>;
}

export interface SubmitResult<T> {
  review: WeeklyReview;
  receipt: WeeklyReviewAction;
  result: T;
  /** The receipt already existed for this submission: nothing was repeated. */
  replayed: boolean;
}

/**
 * One review action: perform the domain change through `perform(tx)`, append
 * the receipt (id = action id), bump the revision, commit. A receipt that
 * already exists for the same review and payload returns its stored result
 * without running `perform`; the same id for a different review or payload
 * is refused. A stale revision is refused before anything runs.
 */
export async function submitAction<T extends Record<string, unknown>>(
  repo: Repository,
  submission: Submission,
  perform: (tx: Repository, review: WeeklyReview) => Promise<T>,
  clock: Clock = systemClock,
): Promise<SubmitResult<T>> {
  return mutate(repo, async (tx) => {
    const existing = await tx.weeklyReviewActions.get(submission.actionId);
    const review = await currentRecord(
      tx.weeklyReviews,
      { id: submission.reviewId },
      { noun: 'weekly review' },
    );
    if (existing) {
      if (!receiptMatches(existing, submission))
        throw new WeeklyReviewError(
          'invalid-step',
          'This action id was already used for a different action.',
        );
      return { review, receipt: existing, result: existing.result as T, replayed: true };
    }
    assertRevision(review, submission.revision);
    if (review.status === 'completed')
      throw new WeeklyReviewError('completed', 'This review is finished and read-only.');
    const result = await perform(tx, review);
    const receipt = await tx.weeklyReviewActions.upsert(
      createRecord(WeeklyReviewActionSchema, clock, {
        id: submission.actionId,
        reviewId: review.id,
        step: submission.step,
        kind: submission.kind,
        refs: submission.refs,
        fingerprint: submission.fingerprint,
        choice: submission.choice,
        result,
        at: clock.now().toISOString(),
        supersedes: null,
      }),
    );
    const next = await tx.weeklyReviews.upsert({
      ...review,
      status: 'inProgress',
      revision: review.revision + 1,
    });
    return { review: next, receipt, result, replayed: false };
  });
}

/** Receipts of one review, oldest first, paged. */
export async function loadReceipts(
  repo: Repository,
  reviewId: Id,
  page: { offset?: number; limit?: number } = {},
): Promise<{ rows: WeeklyReviewAction[]; total: number }> {
  const all = (await repo.weeklyReviewActions.query((a) => a.reviewId === reviewId)).sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1,
  );
  const offset = page.offset ?? 0;
  const limit = page.limit ?? 50;
  return { rows: all.slice(offset, offset + limit), total: all.length };
}

/** Refs decided in a step (any receipt), for computing what still needs a decision. */
export function decidedRefs(
  receipts: readonly WeeklyReviewAction[],
  step: WeeklyReviewStep,
): Set<string> {
  const out = new Set<string>();
  for (const r of receipts)
    if (r.step === step) for (const ref of r.refs) out.add(`${ref.type}:${ref.id}`);
  return out;
}

// ---------------------------------------------------------------------------
// Step data
// ---------------------------------------------------------------------------

export interface InboxStep {
  captures: Capture[];
  inboxTasks: Task[];
  projects: Project[];
  areas: Area[];
  people: Person[];
  fingerprint: string;
}

export async function loadInboxStep(repo: Repository): Promise<InboxStep> {
  const [captures, tasks, projects, areas, people] = await Promise.all([
    repo.captures.query((c) => c.status === 'inbox'),
    repo.tasks.query((t) => t.status === 'inbox'),
    repo.projects.query((p) => p.status === 'active'),
    repo.areas.list(),
    repo.people.list(),
  ]);
  const sortNewest = <T extends { createdAt: string; id: string }>(rows: T[]) =>
    rows.sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? -1 : 1,
    );
  return {
    captures: sortNewest(captures),
    inboxTasks: sortNewest(tasks),
    projects,
    areas,
    people,
    fingerprint: subjectsFingerprint([...captures, ...tasks]),
  };
}

export interface OverdueStep {
  tasks: Array<{
    task: Task;
    project: Project | null;
    /** Live blocks holding this task, by date. */
    blocks: Array<{ id: Id; date: string; locked: boolean }>;
    accepted: boolean;
    blockers: Task[];
  }>;
  fingerprint: string;
}

export async function loadOverdueStep(
  repo: Repository,
  clock: Clock = systemClock,
): Promise<OverdueStep> {
  const [tasks, projects, blocks, commitments] = await Promise.all([
    repo.tasks.list(),
    repo.projects.list(),
    repo.blocks.list(),
    repo.dayCommitments.list(),
  ]);
  const overdue = overdueTasks(tasks, clock.now());
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const today = toLocalDate(clock.now());
  return {
    tasks: overdue.map((task) => ({
      task,
      project: task.projectId ? (projectById.get(task.projectId) ?? null) : null,
      blocks: blocks
        .filter((b) => b.taskId === task.id)
        .map((b) => ({ id: b.id, date: b.date, locked: b.locked })),
      accepted: commitments.some((c) => c.date >= today && c.acceptedTaskIds.includes(task.id)),
      blockers: task.dependsOn
        .map((id) => byId.get(id))
        .filter((t): t is Task => !!t && t.status !== 'done' && t.status !== 'archived'),
    })),
    fingerprint: subjectsFingerprint(overdue),
  };
}

export interface ProjectsStep {
  projects: Array<{
    project: Project;
    health: ProjectHealth;
    openTasks: Task[];
    area: Area | null;
  }>;
  fingerprint: string;
}

export async function loadProjectsStep(
  repo: Repository,
  clock: Clock = systemClock,
): Promise<ProjectsStep> {
  const [projects, allTasks, allMilestones, sessions, areas, settings] = await Promise.all([
    repo.projects.query((p) => p.status === 'active'),
    repo.tasks.list({ includeDeleted: true }),
    repo.milestones.list({ includeDeleted: true }),
    repo.sessions.list(),
    repo.areas.list(),
    readSettings(repo, clock),
  ]);
  const tasks = allTasks.filter((t) => t.deletedAt === null);
  const milestones = allMilestones.filter((m) => m.deletedAt === null);
  const now = clock.now();
  const activity = buildProjectActivity({
    projects,
    tasks: allTasks,
    milestones: allMilestones,
    sessions,
  });
  const healthIndex = buildProjectHealthIndex(allTasks, allMilestones);
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const sorted = [...projects].sort(
    (a, b) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1),
  );
  return {
    projects: sorted.map((project) => ({
      project,
      health: computeProjectHealth(project, {
        milestones,
        tasks,
        sessions,
        now,
        staleAfterDays: settings.insights.staleProjectDays,
        activity,
        index: healthIndex,
      }),
      openTasks: tasks.filter((t) => t.projectId === project.id && t.status === 'open'),
      area: areaById.get(project.areaId) ?? null,
    })),
    fingerprint: subjectsFingerprint(sorted),
  };
}

export interface GoalsStep {
  goals: Array<{ goal: Goal; attention: GoalAttention; area: Area | null; projects: Project[] }>;
  areas: Area[];
  fingerprint: string;
}

export async function loadGoalsStep(
  repo: Repository,
  clock: Clock = systemClock,
): Promise<GoalsStep> {
  const [goals, areas, projects, tasks, sessions] = await Promise.all([
    repo.goals.query((g) => g.status === 'active'),
    repo.areas.list(),
    repo.projects.list(),
    repo.tasks.list(),
    repo.sessions.list(),
  ]);
  const input = { areas, goals, projects, tasks, sessions, now: clock.now() };
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const sorted = [...goals].sort(
    (a, b) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1),
  );
  return {
    goals: sorted.map((goal) => ({
      goal,
      attention: computeGoalAttention(goal, input),
      area: areaById.get(goal.areaId) ?? null,
      projects: projects.filter((p) => p.goalId === goal.id && p.status === 'active'),
    })),
    areas: areas.sort((a, b) => a.name.localeCompare(b.name)),
    fingerprint: subjectsFingerprint([...sorted, ...areas]),
  };
}

export interface BillsStep {
  /** Unpaid bills overdue or due through the target week's end, oldest first. */
  due: Bill[];
  recentPaid: Bill[];
  periodEnd: string;
  fingerprint: string;
}

export async function loadBillsStep(
  repo: Repository,
  review: WeeklyReview,
  clock: Clock = systemClock,
): Promise<BillsStep> {
  const bills = await repo.bills.list();
  const today = toLocalDate(clock.now());
  const periodEnd = addDaysLocal(review.targetWeekStart, 6);
  const groups = groupBills(bills, today);
  const due = [...groups.overdue, ...groups.dueSoon, ...groups.upcoming].filter(
    (b) => b.dueAt !== null && b.dueAt <= periodEnd,
  );
  return {
    due,
    recentPaid: groups.paid.slice(0, 5),
    periodEnd,
    fingerprint: subjectsFingerprint(due),
  };
}

function addDaysLocal(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d + days);
  return toLocalDate(dt);
}

export interface CapacityStep {
  week: WeekCapacity;
  dayOverloadRatio: number;
  fingerprint: string;
}

export interface PatternsStep {
  report: WeeklyTrendReport;
  fingerprint: string;
}

export async function loadPatternsStep(
  repo: Repository,
  review: WeeklyReview,
): Promise<PatternsStep> {
  const [areas, projects, tasks, sessions, blocks, commitments, reflections, bills] =
    await Promise.all([
      repo.areas.list(),
      repo.projects.list(),
      repo.tasks.list(),
      repo.sessions.list(),
      repo.blocks.list(),
      repo.dayCommitments.list(),
      repo.dailyReflections.list(),
      repo.bills.list(),
    ]);
  const report = buildWeeklyTrendReport(review.reviewWeekStart, {
    areas,
    projects,
    tasks,
    sessions,
    blocks,
    commitments,
    reflections,
    bills,
  });
  return { report, fingerprint: report.fingerprint };
}

export async function loadCapacityStep(
  repo: Repository,
  review: WeeklyReview,
  clock: Clock = systemClock,
): Promise<CapacityStep> {
  const [snapshot, settings] = await Promise.all([
    loadInsightSnapshot(repo),
    readSettings(repo, clock),
  ]);
  const inputs = insightInputsFor(settings);
  const index = buildInsightIndex(snapshot, clock.now());
  const week = weekCapacity(
    review.targetWeekStart,
    snapshot,
    index,
    inputs.planning,
    inputs.settings,
    clock.now().toISOString(),
  );
  return {
    week,
    dayOverloadRatio: inputs.settings.dayOverloadRatio,
    fingerprint: subjectsFingerprint([
      ...snapshot.blocks.filter((b) => b.date >= week.weekStart && b.date <= week.weekEnd),
      ...snapshot.areas,
      ...snapshot.dayCommitments.filter((c) => c.date >= week.weekStart && c.date <= week.weekEnd),
    ]),
  };
}

/** Every step's current fingerprint, for the Finish recheck. */
export async function currentFingerprints(
  repo: Repository,
  review: WeeklyReview,
  clock: Clock = systemClock,
): Promise<Record<WeeklyReviewStep, string>> {
  const [inbox, overdue, projects, goals, bills, patterns, capacity] = await Promise.all([
    loadInboxStep(repo),
    loadOverdueStep(repo, clock),
    loadProjectsStep(repo, clock),
    loadGoalsStep(repo, clock),
    loadBillsStep(repo, review, clock),
    loadPatternsStep(repo, review),
    loadCapacityStep(repo, review, clock),
  ]);
  return {
    inbox: inbox.fingerprint,
    overdue: overdue.fingerprint,
    projects: projects.fingerprint,
    goals: goals.fingerprint,
    bills: bills.fingerprint,
    patterns: patterns.fingerprint,
    capacity: capacity.fingerprint,
  };
}

// ---------------------------------------------------------------------------
// Domain actions performed inside `submitAction`
// ---------------------------------------------------------------------------

async function snapshotFor(tx: Repository) {
  const [areas, goals, projects, tasks] = await Promise.all([
    tx.areas.list(),
    tx.goals.list(),
    tx.projects.list(),
    tx.tasks.list(),
  ]);
  return { areas, goals, projects, tasks };
}

/** Convert a capture; an already-processed one returns its original reference. */
export async function convertCaptureWithin(
  tx: Repository,
  captureId: Id,
  options: { type?: CaptureType; projectId?: Id | null; areaId?: Id | null },
  clock: Clock,
): Promise<{ type: string; id: Id; replayed: boolean }> {
  const capture = await currentRecord(tx.captures, { id: captureId }, { noun: 'capture' });
  if (capture.status === 'processed' && capture.processedType && capture.processedId)
    return { type: capture.processedType, id: capture.processedId, replayed: true };
  if (capture.status === 'archived') throw new Error('This capture was archived.');
  const type = options.type ?? capture.type;
  const people = await tx.people.list();
  const projectId = options.projectId ?? null;
  const areaId =
    options.areaId ?? (projectId ? ((await tx.projects.get(projectId))?.areaId ?? null) : null);
  // `readSettings` awaits the store directly: inside an IndexedDB transaction a helper may sit
  // one async level above a store call, not two (`defaultTaskEstimate` would lose Dexie's zone).
  const { records, primary } = materializeCapture(type, captureFields(capture), clock, {
    defaultEstimateMin: (await readSettings(tx, clock)).defaultEstimateMin,
    projectId,
    areaId,
    people,
  });
  for (const r of records) {
    const store = tx[r.store] as unknown as EntityStore<BaseRecord>;
    await store.upsert(r.record);
  }
  await tx.captures.upsert({
    ...capture,
    type,
    status: 'processed',
    processedType: primary.type,
    processedId: primary.id,
  });
  await reconcileReminderQueue(tx, clock);
  return { ...primary, replayed: false };
}

export async function archiveCaptureWithin(
  tx: Repository,
  captureId: Id,
): Promise<{ status: string }> {
  const capture = await currentRecord(tx.captures, { id: captureId }, { noun: 'capture' });
  if (capture.status !== 'inbox') return { status: capture.status };
  await tx.captures.upsert({ ...capture, status: 'archived' });
  return { status: 'archived' };
}

/** Triage an inbox task: assign its parent and open it. */
export async function triageTaskWithin(
  tx: Repository,
  taskId: Id,
  parent: { projectId: Id | null; areaId: Id | null },
): Promise<{ status: string }> {
  const task = await currentRecord(tx.tasks, { id: taskId }, { noun: 'task' });
  const resolved = resolveTaskParent({ ...task, ...parent }, await snapshotFor(tx));
  await tx.tasks.upsert({ ...resolved, status: task.status === 'inbox' ? 'open' : task.status });
  return { status: 'open' };
}

export async function rescheduleTaskWithin(
  tx: Repository,
  taskId: Id,
  dueAt: Instant,
): Promise<{ dueAt: Instant; blocksLeftOnOldDates: number }> {
  const task = await currentRecord(tx.tasks, { id: taskId }, { noun: 'task' });
  if (!Number.isFinite(new Date(dueAt).getTime())) throw new Error('Enter a real date.');
  await tx.tasks.upsert({ ...task, dueAt, status: task.status === 'inbox' ? 'open' : task.status });
  const newDate = toLocalDate(new Date(dueAt));
  const blocks = await tx.blocks.query((b) => b.taskId === taskId && b.date !== newDate);
  return { dueAt, blocksLeftOnOldDates: blocks.length };
}

export async function inboxTaskWithin(
  tx: Repository,
  taskId: Id,
  options: { clearDeadline: boolean },
): Promise<{ status: string }> {
  const task = await currentRecord(tx.tasks, { id: taskId }, { noun: 'task' });
  await tx.tasks.upsert({
    ...task,
    status: 'inbox',
    dueAt: options.clearDeadline ? null : task.dueAt,
  });
  return { status: 'inbox' };
}

/** Archive a task and clear any project's next-action pointer to it. */
export async function archiveTaskWithin(
  tx: Repository,
  taskId: Id,
): Promise<{ status: string; nextActionsCleared: number }> {
  const task = await currentRecord(tx.tasks, { id: taskId }, { noun: 'task' });
  await tx.tasks.upsert({ ...task, status: 'archived' });
  const pointing = await tx.projects.query((p) => p.nextActionTaskId === taskId);
  for (const p of pointing) await tx.projects.upsert({ ...p, nextActionTaskId: null });
  return { status: 'archived', nextActionsCleared: pointing.length };
}

export async function completeTaskWithin(
  tx: Repository,
  taskId: Id,
  actualMin: number | null,
  clock: Clock,
): Promise<{ status: string; actualMin: number | null }> {
  const task = await currentRecord(tx.tasks, { id: taskId }, { noun: 'task' });
  if (task.status === 'done') return { status: 'done', actualMin: task.actualMin };
  let sessions = await tx.sessions.query((s) => s.taskId === taskId);
  const running = sessions.find((s) => s.endAt === null);
  if (running) {
    const stopped = await tx.sessions.upsert(stopSession(running, clock));
    sessions = sessions.map((s) => (s.id === running.id ? stopped : s));
  }
  const done = await tx.tasks.upsert(completeTaskRule(task, actualMin, sessions, clock));
  return { status: 'done', actualMin: done.actualMin };
}

/** Set a project's next action from a live, open task of that project, revalidated now. */
export async function setNextActionWithin(
  tx: Repository,
  projectId: Id,
  taskId: Id | null,
): Promise<{ nextActionTaskId: Id | null }> {
  const project = await currentRecord(tx.projects, { id: projectId }, { noun: 'project' });
  if (project.status === 'archived') throw new Error('That project is archived.');
  if (taskId) {
    const task = await currentRecord(tx.tasks, { id: taskId }, { noun: 'task' });
    if (task.projectId !== projectId) throw new Error('That task belongs to another project.');
    if (task.status !== 'open') throw new Error('A next action must be an open task.');
  }
  await tx.projects.upsert({ ...project, nextActionTaskId: taskId });
  return { nextActionTaskId: taskId };
}

export async function createNextActionWithin(
  tx: Repository,
  projectId: Id,
  title: string,
  clock: Clock,
): Promise<{ taskId: Id }> {
  const project = await currentRecord(tx.projects, { id: projectId }, { noun: 'project' });
  if (project.status === 'archived') throw new Error('That project is archived.');
  if (!title.trim()) throw new Error('A title is required.');
  const task = await tx.tasks.upsert(
    createRecord(TaskSchema, clock, {
      title: title.trim(),
      status: 'open',
      projectId,
      areaId: project.areaId,
      estimateMin: (await readSettings(tx, clock)).defaultEstimateMin,
    }),
  );
  await tx.projects.upsert({ ...project, nextActionTaskId: task.id });
  return { taskId: task.id };
}

export async function editProjectWithin(
  tx: Repository,
  base: Project,
  patch: Partial<Pick<Project, 'outcome' | 'deadline' | 'title'>>,
): Promise<{ updated: string[] }> {
  const current = await currentRecord(tx.projects, { id: base.id }, { noun: 'project' });
  await tx.projects.upsert(mergePatch<Project>(current, base, patch));
  return { updated: Object.keys(patch) };
}

export async function archiveProjectWithin(
  tx: Repository,
  projectId: Id,
): Promise<{ archivedTasks: number }> {
  const project = await currentRecord(tx.projects, { id: projectId }, { noun: 'project' });
  const { project: archived, tasks } = archiveProjectCascade(project, await snapshotFor(tx));
  await tx.projects.upsert(archived);
  for (const t of tasks) await tx.tasks.upsert(t);
  return { archivedTasks: tasks.length };
}

export async function updateGoalWithin(
  tx: Repository,
  base: Goal,
  patch: Partial<Pick<Goal, 'importance' | 'targetDate' | 'status'>>,
): Promise<{ updated: string[] }> {
  const current = await currentRecord(tx.goals, { id: base.id }, { noun: 'goal' });
  await tx.goals.upsert(mergePatch<Goal>(current, base, patch));
  return { updated: Object.keys(patch) };
}

export async function setAreaTargetWithin(
  tx: Repository,
  areaId: Id,
  weeklyHoursTarget: number,
): Promise<{ weeklyHoursTarget: number }> {
  const area = await currentRecord(tx.areas, { id: areaId }, { noun: 'area' });
  if (!Number.isFinite(weeklyHoursTarget) || weeklyHoursTarget < 0 || weeklyHoursTarget > 168)
    throw new Error('Enter hours between 0 and 168.');
  await tx.areas.upsert({ ...area, weeklyHoursTarget });
  return { weeklyHoursTarget };
}

export async function payBillWithin(
  tx: Repository,
  billId: Id,
  paidAt: Instant,
  clock: Clock,
): Promise<Record<string, unknown>> {
  const outcome: PaymentOutcome = await payWithin(tx, { id: billId }, paidAt, clock);
  return {
    paid: outcome.paid.id,
    successorId: outcome.successor?.id ?? null,
    successorDueAt: outcome.successor?.dueAt ?? null,
    plan: outcome.plan.kind,
    replayed: outcome.replayed,
  };
}

// ---------------------------------------------------------------------------
// Finish
// ---------------------------------------------------------------------------

export interface FinishCheck {
  changed: WeeklyReviewStep[];
  unresolved: Array<{ step: WeeklyReviewStep; ref: ReviewRef }>;
  missing: WeeklyReviewStep[];
}

/** What Finish would have to acknowledge: changed steps, deferred items, unacknowledged steps. */
export async function checkFinish(
  repo: Repository,
  review: WeeklyReview,
  clock: Clock = systemClock,
): Promise<FinishCheck> {
  const fingerprints = await currentFingerprints(repo, review, clock);
  const receipts = await repo.weeklyReviewActions.query((a) => a.reviewId === review.id);
  const changed = review.steps
    .filter((s) => fingerprints[s.step] !== s.fingerprint)
    .map((s) => s.step);
  const missing = WEEKLY_REVIEW_STEPS.filter((s) => !review.steps.some((o) => o.step === s));
  const unresolved: FinishCheck['unresolved'] = [];
  for (const step of WEEKLY_REVIEW_STEPS)
    for (const ref of deferredRefs(receipts, step)) unresolved.push({ step, ref });
  return { changed, unresolved, missing };
}

/**
 * Finish: recheck the revision and every step's fingerprint, then in one
 * transaction set completed with a compact summary of what was reviewed
 * and decided. Repeated Finish returns the same completed record.
 */
export async function finishReview(
  repo: Repository,
  id: Id,
  revision: number,
  clock: Clock = systemClock,
): Promise<{ review: WeeklyReview; check: FinishCheck }> {
  const before = await currentRecord(repo.weeklyReviews, { id }, { noun: 'weekly review' });
  if (before.status === 'completed')
    return { review: before, check: { changed: [], unresolved: [], missing: [] } };
  const check = await checkFinish(repo, before, clock);
  if (check.changed.length || check.missing.length) return { review: before, check };
  const capacity = await loadCapacityStep(repo, before, clock);
  const receipts = await repo.weeklyReviewActions.query((a) => a.reviewId === id);
  const labels = await labelsFor(
    repo,
    check.unresolved.map((u) => u.ref),
  );
  const summary: WeeklyReviewSummary = {
    version: 1,
    reviewWeekStart: before.reviewWeekStart,
    targetWeekStart: before.targetWeekStart,
    computedAt: clock.now().toISOString(),
    steps: [],
    actionCount: receipts.length,
    items: check.unresolved.slice(0, 500).map((u) => ({
      step: u.step,
      ref: u.ref,
      label: labels.get(`${u.ref.type}:${u.ref.id}`) ?? '',
      status: 'deferred' as const,
    })),
    capacity: capacitySummary(capacity.week),
  };
  const review = await mutate(repo, async (tx) => {
    const current = await currentReview(tx, id, revision);
    return tx.weeklyReviews.upsert(completeReview(current, summary, clock));
  });
  return { review, check };
}

/** Human labels for refs the summary names. */
export async function labelsFor(
  repo: Repository,
  refs: readonly ReviewRef[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const ref of refs) {
    const key = `${ref.type}:${ref.id}`;
    if (out.has(key)) continue;
    let label: string;
    switch (ref.type) {
      case 'task':
        label = (await repo.tasks.get(ref.id))?.title ?? '';
        break;
      case 'project':
        label = (await repo.projects.get(ref.id))?.title ?? '';
        break;
      case 'goal':
        label = (await repo.goals.get(ref.id))?.title ?? '';
        break;
      case 'bill':
        label = (await repo.bills.get(ref.id))?.title ?? '';
        break;
      case 'capture':
        label = (await repo.captures.get(ref.id))?.text ?? '';
        break;
      case 'area':
        label = (await repo.areas.get(ref.id))?.name ?? '';
        break;
      default:
        label = '';
    }
    out.set(key, label.slice(0, 200));
  }
  return out;
}

/** Soft-delete a review's history only; nothing in the domain is reversed. */
export async function deleteReview(repo: Repository, id: Id): Promise<void> {
  await mutate(repo, async (tx) => {
    await currentRecord(tx.weeklyReviews, { id }, { noun: 'weekly review' });
    await tx.weeklyReviews.softDelete(id);
  });
}

export { newId, WeeklyReviewError };
