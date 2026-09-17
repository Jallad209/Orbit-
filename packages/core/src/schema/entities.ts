import { z } from 'zod';
import {
  BaseRecordSchema,
  EnergySchema,
  EntityTypeSchema,
  IdSchema,
  InstantSchema,
  LocalDateSchema,
  MinuteOfDaySchema,
  PrioritySchema,
  WeekdaySchema,
} from './common';

const title = z.string().trim().min(1, 'title is required');
const nullableId = IdSchema.nullable().default(null);
const nullableInstant = InstantSchema.nullable().default(null);
const nullableDate = LocalDateSchema.nullable().default(null);

// ---------------------------------------------------------------------------
// Structure: Area → Goal → Project → Task
// ---------------------------------------------------------------------------

export const AreaSchema = BaseRecordSchema.extend({
  name: title,
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, 'must be a hex color')
    .default('#D4A93A'),
  weeklyHoursTarget: z.number().min(0).max(168).default(0),
});
export type Area = z.infer<typeof AreaSchema>;

export const GoalStatusSchema = z.enum(['active', 'achieved', 'dropped']);
export const GoalSchema = BaseRecordSchema.extend({
  title,
  areaId: IdSchema,
  importance: z.number().int().min(1).max(5).default(3),
  targetDate: nullableDate,
  status: GoalStatusSchema.default('active'),
});
export type Goal = z.infer<typeof GoalSchema>;

export const ProjectStatusSchema = z.enum(['active', 'completed', 'archived']);
export const ProjectSchema = BaseRecordSchema.extend({
  title,
  goalId: nullableId,
  areaId: IdSchema,
  outcome: z.string().default(''),
  deadline: nullableDate,
  status: ProjectStatusSchema.default('active'),
  nextActionTaskId: nullableId,
});
export type Project = z.infer<typeof ProjectSchema>;

export const MilestoneSchema = BaseRecordSchema.extend({
  projectId: IdSchema,
  title,
  done: z.boolean().default(false),
  order: z.number().int().min(0).default(0),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

/** `inbox` = captured but not yet triaged. */
export const TaskStatusSchema = z.enum(['inbox', 'open', 'done', 'archived']);
export const TaskSchema = BaseRecordSchema.extend({
  title,
  projectId: nullableId,
  areaId: nullableId,
  status: TaskStatusSchema.default('inbox'),
  priority: PrioritySchema.default(2),
  estimateMin: z.number().int().min(0).default(30),
  /** Optional day the user would prefer to work on this task. */
  preferredDate: nullableDate,
  /** Optional preferred start on `preferredDate`; the planner may move it around conflicts. */
  preferredStartMin: MinuteOfDaySchema.nullable().default(null),
  actualMin: z.number().int().min(0).nullable().default(null),
  dueAt: nullableInstant,
  energy: EnergySchema.default('medium'),
  dependsOn: z.array(IdSchema).default([]),
  notes: z.string().default(''),
  completedAt: nullableInstant,
}).superRefine((task, ctx) => {
  if (task.dependsOn.includes(task.id)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dependsOn'],
      message: 'a task cannot depend on itself',
    });
  }
});
export type Task = z.infer<typeof TaskSchema>;

// ---------------------------------------------------------------------------
// Time: Event, Routine, RoutineInstance, Block, DayCommitment, Session
// ---------------------------------------------------------------------------

export const EventSchema = BaseRecordSchema.extend({
  title,
  startAt: InstantSchema,
  endAt: InstantSchema,
  source: z.enum(['manual', 'import']).default('manual'),
  locked: z.boolean().default(true),
}).refine((e) => e.endAt > e.startAt, { path: ['endAt'], message: 'must end after start' });
export type Event = z.infer<typeof EventSchema>;

export const RecurrenceSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly']),
  interval: z.number().int().min(1).default(1),
  byDay: z.array(WeekdaySchema).default([]),
  byMonthDay: z.number().int().min(1).max(31).nullable().default(null),
  count: z.number().int().min(1).nullable().default(null),
  until: nullableDate,
});
export type Recurrence = z.infer<typeof RecurrenceSchema>;

export const TimeWindowSchema = z
  .object({ startMin: MinuteOfDaySchema, endMin: MinuteOfDaySchema })
  .refine((w) => w.endMin > w.startMin, { path: ['endMin'], message: 'must end after start' });
export type TimeWindow = z.infer<typeof TimeWindowSchema>;

export const RoutineSchema = BaseRecordSchema.extend({
  title,
  recurrence: RecurrenceSchema,
  /** First day the recurrence counts from; the creation date when null. */
  startDate: nullableDate,
  durationMin: z.number().int().min(5).default(30),
  energy: EnergySchema.default('medium'),
  preferredWindow: TimeWindowSchema.nullable().default(null),
  areaId: nullableId,
});
export type Routine = z.infer<typeof RoutineSchema>;

export const RoutineInstanceSchema = BaseRecordSchema.extend({
  routineId: IdSchema,
  date: LocalDateSchema,
  status: z.enum(['planned', 'done', 'skipped']).default('planned'),
});
export type RoutineInstance = z.infer<typeof RoutineInstanceSchema>;

export const BlockSchema = BaseRecordSchema.extend({
  date: LocalDateSchema,
  startMin: MinuteOfDaySchema,
  endMin: MinuteOfDaySchema,
  taskId: nullableId,
  routineInstanceId: nullableId,
  eventId: nullableId,
  locked: z.boolean().default(false),
  source: z.enum(['planner', 'manual']).default('planner'),
}).superRefine((b, ctx) => {
  if (b.endMin <= b.startMin) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endMin'],
      message: 'must end after start',
    });
  }
  const refs = [b.taskId, b.routineInstanceId, b.eventId].filter((r) => r !== null).length;
  if (refs > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['taskId'],
      message: 'a block references at most one of task, routine instance, or event',
    });
  }
});
export type Block = z.infer<typeof BlockSchema>;

export const DayCommitmentSchema = BaseRecordSchema.extend({
  date: LocalDateSchema,
  acceptedTaskIds: z.array(IdSchema).default([]),
  energy: EnergySchema.default('medium'),
  acceptedAt: InstantSchema,
});
export type DayCommitment = z.infer<typeof DayCommitmentSchema>;

/** A work session. `endAt === null` while the timer is running. */
export const SessionSchema = BaseRecordSchema.extend({
  taskId: IdSchema,
  startAt: InstantSchema,
  endAt: nullableInstant,
}).refine((s) => s.endAt === null || s.endAt >= s.startAt, {
  path: ['endAt'],
  message: 'must end after start',
});
export type Session = z.infer<typeof SessionSchema>;

// ---------------------------------------------------------------------------
// Knowledge & people: Note, Person, Commitment, Bill
// ---------------------------------------------------------------------------

export const NoteSchema = BaseRecordSchema.extend({
  title,
  body: z.string().default(''),
  projectId: nullableId,
  areaId: nullableId,
});
export type Note = z.infer<typeof NoteSchema>;

export const PersonSchema = BaseRecordSchema.extend({
  name: title,
  contact: z.string().default(''),
  lastContactAt: nullableInstant,
  /** Optional user-chosen schedule to reconnect; distinct from the last real contact. */
  followUpDate: nullableDate,
  followUpTime: MinuteOfDaySchema.nullable().default(null),
});
export type Person = z.infer<typeof PersonSchema>;

export const CommitmentSchema = BaseRecordSchema.extend({
  personId: IdSchema,
  text: title,
  dueAt: nullableInstant,
  status: z.enum(['open', 'done', 'dropped']).default('open'),
  direction: z.enum(['owed-by-me', 'owed-to-me']).default('owed-by-me'),
});
export type Commitment = z.infer<typeof CommitmentSchema>;

/**
 * v1 "expense" is a bill: an amount with a due date. Since week 12 a bill is
 * one occurrence of a possibly recurring schedule, and the schedule travels
 * with the chain rather than living in a separate series store:
 * - `seriesId` groups every occurrence generated from one original
 *   schedule (null for a one-off bill; a legacy recurring row is its own
 *   series root, so its id is the series id);
 * - `recurrenceAnchor` is the original schedule's first date and is never
 *   moved to a clamped month-end date;
 * - `occurrenceIndex` is the zero-based position under the original rule,
 *   so COUNT is counted from the rule, not from how often "Mark paid" ran;
 * - `scheduledFor` is the date the rule produced for this occurrence;
 *   `dueAt` may be an explicit override of that installment's deadline;
 * - `paidAt` is when the payment was recorded (null on legacy paid rows:
 *   "payment time not recorded", never invented);
 * - `nextBillId` links the one successor a payment generated;
 * - `repeatStopped` stops generation from this occurrence on while keeping
 *   the recurrence description and history intact.
 */
export const BillSchema = BaseRecordSchema.extend({
  /** Expenses share the durable money ledger while bill scheduling remains backwards compatible. */
  kind: z.enum(['bill', 'expense']).default('bill'),
  title,
  amount: z.number().finite().min(0),
  currency: z.string().default(''),
  /** Undated bills remain visible in the upcoming group until the user schedules them. */
  dueAt: nullableDate,
  /** Optional minutes after midnight on the due date. */
  dueTime: MinuteOfDaySchema.nullable().default(null),
  recurrence: RecurrenceSchema.nullable().default(null),
  paid: z.boolean().default(false),
  seriesId: nullableId,
  recurrenceAnchor: nullableDate,
  occurrenceIndex: z.number().int().min(0).default(0),
  scheduledFor: nullableDate,
  paidAt: nullableInstant,
  nextBillId: nullableId,
  repeatStopped: z.boolean().default(false),
}).superRefine((bill, ctx) => {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (bill.seriesId === null) {
    if (bill.occurrenceIndex !== 0) issue('occurrenceIndex', 'a one-off bill has no position');
    if (bill.nextBillId !== null) issue('nextBillId', 'a one-off bill has no successor');
  } else {
    if (bill.recurrence === null) issue('recurrence', 'a series occurrence keeps its rule');
    if (bill.recurrenceAnchor === null) issue('recurrenceAnchor', 'a series has an anchor');
    if (bill.scheduledFor === null) issue('scheduledFor', 'a series occurrence has a date');
    if (
      bill.recurrence?.count !== null &&
      bill.recurrence?.count !== undefined &&
      bill.occurrenceIndex >= bill.recurrence.count
    ) {
      issue('occurrenceIndex', "beyond the rule's count");
    }
  }
  if (bill.paidAt !== null && !bill.paid) issue('paidAt', 'an unpaid bill has no payment time');
  if (bill.nextBillId !== null && !bill.paid)
    issue('nextBillId', 'only a paid bill has a successor');
  if (bill.nextBillId === bill.id) issue('nextBillId', 'a bill cannot succeed itself');
});
export type Bill = z.infer<typeof BillSchema>;

// ---------------------------------------------------------------------------
// Rules — four typed families, never parsed sentences
// ---------------------------------------------------------------------------

const RuleBase = BaseRecordSchema.extend({
  name: z.string().default(''),
  enabled: z.boolean().default(true),
});

export const ConstraintConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('noHighEnergyAfter'), afterMin: MinuteOfDaySchema }),
  z.object({
    kind: z.literal('reserve'),
    dayOfWeek: WeekdaySchema,
    startMin: MinuteOfDaySchema,
    endMin: MinuteOfDaySchema,
    areaId: nullableId,
    label: z.string().default(''),
  }),
]);

export const RolloverTargetSchema = z.enum(['tomorrow', 'nextWeek', 'inbox']);
export type RolloverTarget = z.infer<typeof RolloverTargetSchema>;
export const RolloverConfigSchema = z.object({
  p1: RolloverTargetSchema.default('tomorrow'),
  p2: RolloverTargetSchema.default('tomorrow'),
  p3: RolloverTargetSchema.default('nextWeek'),
});
export type RolloverConfig = z.infer<typeof RolloverConfigSchema>;

export const ReminderConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('billDueWithin'), days: z.number().int().min(0).max(60) }),
  z.object({ kind: z.literal('followUpAfter'), days: z.number().int().min(1).max(365) }),
]);

export const RuleSchema = z
  .discriminatedUnion('type', [
    RuleBase.extend({ type: z.literal('constraint'), config: ConstraintConfigSchema }),
    RuleBase.extend({
      type: z.literal('recurring'),
      config: z.object({ routineId: IdSchema, timesPerWeek: z.number().int().min(1).max(7) }),
    }),
    RuleBase.extend({ type: z.literal('rollover'), config: RolloverConfigSchema }),
    RuleBase.extend({ type: z.literal('reminder'), config: ReminderConfigSchema }),
  ])
  .superRefine((rule, ctx) => {
    // A reserved window is two loose minute fields, not a TimeWindow: check the order here.
    if (rule.type === 'constraint' && rule.config.kind === 'reserve') {
      if (rule.config.endMin <= rule.config.startMin) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config', 'endMin'],
          message: 'must end after start',
        });
      }
    }
  });
export type Rule = z.infer<typeof RuleSchema>;
export type RuleType = Rule['type'];

// ---------------------------------------------------------------------------
// Connections & system: Link, InsightState, OpLog
// ---------------------------------------------------------------------------

export const LinkSchema = BaseRecordSchema.extend({
  fromType: EntityTypeSchema,
  fromId: IdSchema,
  toType: EntityTypeSchema,
  toId: IdSchema,
  linkType: z.string().default('related'),
});
export type Link = z.infer<typeof LinkSchema>;

export const InsightKindSchema = z.enum([
  'estimate-bias',
  'stale-project',
  'overloaded-day',
  'weekly-target-deficit',
  'person-commitments',
]);
export type InsightKind = z.infer<typeof InsightKindSchema>;

export const InsightSeveritySchema = z.enum(['risk', 'attention', 'info']);
export type InsightSeverity = z.infer<typeof InsightSeveritySchema>;

/** What an insight is about. Dated subjects carry the date; entity subjects the id. */
export const InsightSubjectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('area'), id: IdSchema }),
  z.object({ type: z.literal('unassigned') }),
  z.object({ type: z.literal('project'), id: IdSchema }),
  z.object({ type: z.literal('date'), date: LocalDateSchema }),
  z.object({ type: z.literal('week'), weekStart: LocalDateSchema }),
  z.object({ type: z.literal('person'), id: IdSchema }),
]);
export type InsightSubject = z.infer<typeof InsightSubjectSchema>;

/**
 * What the history view shows for a suppressed insight after its source
 * data moved on: the kind, wording, subject, and the numbers behind the
 * title. Never the evidence rows. Versioned so a later shape can be told apart.
 */
export const InsightSummarySchema = z.object({
  version: z.literal(1),
  kind: InsightKindSchema,
  severity: InsightSeveritySchema,
  title: z.string(),
  detail: z.string().default(''),
  subject: InsightSubjectSchema,
  metrics: z.record(z.number()).default({}),
});
export type InsightSummary = z.infer<typeof InsightSummarySchema>;

/** `time`: until `snoozedUntil`; `change`: until the fingerprint differs; null: not snoozed. */
export const InsightSnoozeModeSchema = z.enum(['time', 'change']);
export type InsightSnoozeMode = z.infer<typeof InsightSnoozeModeSchema>;

/**
 * Suppression state for one insight key (week 11). The key is a lookup, the
 * id stays a UUID. `dismissedAt` is permanent until restored; a snooze is
 * either timed or "until data changes", in which case `suppressedFingerprint`
 * remembers what the data looked like when it was snoozed.
 */
export const InsightStateSchema = BaseRecordSchema.extend({
  insightKey: z.string().min(1),
  snoozedUntil: nullableInstant,
  dismissedAt: nullableInstant,
  snoozeMode: InsightSnoozeModeSchema.nullable().default(null),
  suppressedFingerprint: z.string().nullable().default(null),
  lastSummary: InsightSummarySchema.nullable().default(null),
});
export type InsightState = z.infer<typeof InsightStateSchema>;

export const OpSchema = z.enum(['create', 'update', 'delete']);
export type Op = z.infer<typeof OpSchema>;

/** Append-only change log. Powers undo, insights, and future sync. */
export const OpLogEntrySchema = z.object({
  seq: z.number().int().min(1),
  entity: EntityTypeSchema,
  entityId: IdSchema,
  op: OpSchema,
  patch: z.record(z.unknown()),
  at: InstantSchema,
});
export type OpLogEntry = z.infer<typeof OpLogEntrySchema>;

// ---------------------------------------------------------------------------
// Inbox: Capture
// ---------------------------------------------------------------------------

/** What a capture can become. `commitment` is a relationship reminder. */
export const CaptureTypeSchema = z.enum([
  'task',
  'event',
  'note',
  'goal',
  'routine',
  'bill',
  'commitment',
]);
export type CaptureType = z.infer<typeof CaptureTypeSchema>;

export const CaptureStatusSchema = z.enum(['inbox', 'processed', 'archived']);

/**
 * A raw capture waiting in the inbox. Holds the parser's guess so the UI can
 * show and correct it; triage turns it into a real entity (`processedId`).
 */
export const CaptureSchema = BaseRecordSchema.extend({
  text: z.string().trim().min(1, 'text is required'),
  type: CaptureTypeSchema,
  fields: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1).default(0),
  status: CaptureStatusSchema.default('inbox'),
  processedType: EntityTypeSchema.nullable().default(null),
  processedId: nullableId,
});
export type Capture = z.infer<typeof CaptureSchema>;

// ---------------------------------------------------------------------------
// Reminders & settings (week 9)
// ---------------------------------------------------------------------------

export const ReminderStatusSchema = z.enum(['pending', 'fired', 'dismissed']);
export type ReminderStatus = z.infer<typeof ReminderStatusSchema>;

/**
 * A queued notification produced by a reminder rule. `key` is
 * `${ruleId}:${entityId}:${dueDate}`: the thing being reminded about, never
 * the fire time, so re-evaluating the rules cannot queue the same reminder
 * twice. The scheduler (Rust on desktop, a hook on web) fires rows whose
 * `fireAt` has passed and marks them `fired`.
 */
export const ReminderSchema = BaseRecordSchema.extend({
  key: z.string().min(1),
  /** Rule reminders name their rule; direct reminders are created by a feature. */
  ruleId: IdSchema.nullable().default(null),
  source: z.enum(['rule', 'review-step', 'person-follow-up', 'monthly-spending']).default('rule'),
  entityType: EntityTypeSchema,
  entityId: IdSchema,
  /** An internal route opened when the notification is activated. */
  destination: z.string().startsWith('/').nullable().default(null),
  fireAt: InstantSchema,
  title,
  body: z.string().default(''),
  status: ReminderStatusSchema.default('pending'),
});
export type Reminder = z.infer<typeof ReminderSchema>;

/** The one settings document's id (a fixed UUID so every adapter can `get` it). */
export const APP_SETTINGS_ID = '00000000-0000-7000-8000-000000000001';

/**
 * Planning preferences, persisted through the repository so they travel
 * with the data (export, desktop import). One document, `APP_SETTINGS_ID`.
 */
/**
 * Thresholds the insight detectors use (week 11). Bounds are the accepted
 * range for a newly entered value; an old record missing the group gets
 * these defaults through `normalizeAppSettings`.
 */
export const InsightSettingsSchema = z.object({
  /** Complete elapsed 24-hour periods without activity before a project is stale. */
  staleProjectDays: z.number().int().min(1).max(90).default(10),
  /** How many elapsed days of completed tasks the estimate comparison looks at. */
  estimateWindowDays: z.number().int().min(7).max(180).default(30),
  /** Completed tasks with both an estimate and an actual needed before comparing. */
  estimateMinSamples: z.number().int().min(5).max(100).default(5),
  /** actual ÷ estimate above which recorded work is reported. */
  estimateRatioThreshold: z.number().finite().min(1.05).max(3).default(1.3),
  /** Committed work ÷ full-day capacity above which a day is overloaded. */
  dayOverloadRatio: z.number().finite().min(1).max(2).default(1.1),
  /** Open commitments with one person from which they are listed. */
  personCommitmentCount: z.number().int().min(1).max(20).default(3),
});
export type InsightSettings = z.infer<typeof InsightSettingsSchema>;

export const ReviewQuestionIdSchema = z.enum(['project', 'bill', 'person']);
export type ReviewQuestionId = z.infer<typeof ReviewQuestionIdSchema>;

const CaptureTemplateSchema = z.object({
  id: IdSchema,
  kind: ReviewQuestionIdSchema,
  name: title,
  values: z.record(z.string(), z.string()).default({}),
});
export type CaptureTemplate = z.infer<typeof CaptureTemplateSchema>;

export const ReviewSettingsSchema = z.object({
  questionOrder: z
    .array(ReviewQuestionIdSchema)
    .length(3)
    .refine((items) => new Set(items).size === 3, 'questions must appear once')
    .default(['project', 'bill', 'person']),
  enabledQuestions: z.array(ReviewQuestionIdSchema).default(['project', 'bill', 'person']),
  templates: z.array(CaptureTemplateSchema).max(20).default([]),
});
export type ReviewSettings = z.infer<typeof ReviewSettingsSchema>;
export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = ReviewSettingsSchema.parse({});

export const AppSettingsSchema = BaseRecordSchema.extend({
  workingWindow: TimeWindowSchema.default({ startMin: 540, endMin: 1080 }),
  /** Never planned into; a lunch break by default. */
  restBoundaries: z.array(TimeWindowSchema).default([{ startMin: 750, endMin: 795 }]),
  /** Gap left after every placed block. */
  bufferMin: z.number().int().min(0).max(120).default(10),
  /** Estimate for a task captured without one. */
  defaultEstimateMin: z.number().int().min(5).max(480).default(30),
  /** When the "Evening shutdown" launcher appears. */
  eveningStartMin: MinuteOfDaySchema.default(17 * 60),
  /** Insight thresholds; restoring their defaults leaves the planning fields alone. */
  insights: InsightSettingsSchema.default({}),
  /** Morning question order, visibility, and local capture templates. */
  reviews: ReviewSettingsSchema.default({}),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

// ---------------------------------------------------------------------------
// Daily reviews: resumable morning state and explicit evening reflection
// ---------------------------------------------------------------------------

export const DailyReviewKindSchema = z.enum(['morning', 'evening']);
export type DailyReviewKind = z.infer<typeof DailyReviewKindSchema>;
export const DailyReviewStepSchema = z.enum([
  'project',
  'bill',
  'person',
  'energy',
  'at-risk',
  'plan',
  'accept',
]);
export type DailyReviewStep = z.infer<typeof DailyReviewStepSchema>;

export const DailyReviewDraftSchema = BaseRecordSchema.extend({
  date: LocalDateSchema,
  kind: DailyReviewKindSchema,
  step: DailyReviewStepSchema,
  formState: z.record(z.string(), z.unknown()).default({}),
  createdRefs: z
    .array(z.object({ type: EntityTypeSchema, id: IdSchema }))
    .max(100)
    .default([]),
  deferredQuestions: z.array(ReviewQuestionIdSchema).default([]),
  reminderTime: MinuteOfDaySchema.nullable().default(null),
});
export type DailyReviewDraft = z.infer<typeof DailyReviewDraftSchema>;

export const ReflectionRatingSchema = z.number().int().min(1).max(5).nullable().default(null);
export const DailyReflectionSchema = BaseRecordSchema.extend({
  date: LocalDateSchema,
  journalNoteId: nullableId,
  promptId: z.string().max(80).nullable().default(null),
  mood: ReflectionRatingSchema,
  stress: ReflectionRatingSchema,
  sleepQuality: ReflectionRatingSchema,
  tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  completedAt: nullableInstant,
});
export type DailyReflection = z.infer<typeof DailyReflectionSchema>;

// ---------------------------------------------------------------------------
// Weekly review (week 12): a resumable six-step flow with durable receipts
// ---------------------------------------------------------------------------

/** The six steps, by stable identifier. The closing summary is not a step. */
export const WeeklyReviewStepSchema = z.enum([
  'inbox',
  'overdue',
  'projects',
  'goals',
  'bills',
  'patterns',
  'capacity',
]);
export type WeeklyReviewStep = z.infer<typeof WeeklyReviewStepSchema>;
export const WEEKLY_REVIEW_STEPS: readonly WeeklyReviewStep[] = WeeklyReviewStepSchema.options;

export const WeeklyReviewStatusSchema = z.enum(['inProgress', 'paused', 'completed']);
export type WeeklyReviewStatus = z.infer<typeof WeeklyReviewStatusSchema>;

/** A typed reference from a review or a receipt to the record it concerns. */
export const ReviewRefSchema = z.object({ type: EntityTypeSchema, id: IdSchema });
export type ReviewRef = z.infer<typeof ReviewRefSchema>;

/**
 * What a step's acknowledgement recorded: the subject set it covered (as a
 * fingerprint, so a later change is detectable), when, and the counts at
 * that moment. `deferred` is a decision, not a healthy state.
 */
export const WeeklyReviewStepOutcomeSchema = z.object({
  step: WeeklyReviewStepSchema,
  status: z.enum(['done', 'deferred']),
  at: InstantSchema,
  /** Fingerprint of the subjects shown when the step was acknowledged. */
  fingerprint: z.string().default(''),
  resolved: z.number().int().min(0).default(0),
  deferred: z.number().int().min(0).default(0),
  remaining: z.number().int().min(0).default(0),
  reason: z.string().max(500).default(''),
});
export type WeeklyReviewStepOutcome = z.infer<typeof WeeklyReviewStepOutcomeSchema>;

/**
 * Unsubmitted choices saved by Pause. Restoring the draft never applies an
 * action or marks anything reviewed; it puts the choices back for an
 * explicit Apply. Each choice carries the fingerprint of the record it was
 * made against so a changed record is shown as changed.
 */
export const WeeklyReviewDraftChoiceSchema = z.object({
  ref: ReviewRefSchema,
  baseFingerprint: z.string().default(''),
  choice: z.record(z.unknown()).default({}),
});
export const WeeklyReviewStepDraftSchema = z.object({
  version: z.literal(1),
  step: WeeklyReviewStepSchema,
  savedAt: InstantSchema,
  choices: z.array(WeeklyReviewDraftChoiceSchema).max(200).default([]),
});
export type WeeklyReviewStepDraft = z.infer<typeof WeeklyReviewStepDraftSchema>;

/** One unresolved or deferred item named by the completion summary. */
export const WeeklyReviewSummaryItemSchema = z.object({
  step: WeeklyReviewStepSchema,
  ref: ReviewRefSchema,
  label: z.string().max(200).default(''),
  status: z.enum(['deferred', 'unresolved', 'changed']),
});

/**
 * The compact historical record written by Finish. It says what was
 * reviewed and decided at that moment and never changes afterwards.
 */
export const WeeklyReviewSummarySchema = z.object({
  version: z.literal(1),
  reviewWeekStart: LocalDateSchema,
  targetWeekStart: LocalDateSchema,
  computedAt: InstantSchema,
  steps: z.array(WeeklyReviewStepOutcomeSchema).default([]),
  /** Receipts committed by this review. */
  actionCount: z.number().int().min(0).default(0),
  items: z.array(WeeklyReviewSummaryItemSchema).max(500).default([]),
  capacity: z
    .object({
      bookedMin: z.number().int().min(0),
      availableMin: z.number().int().min(0),
      targetMin: z.number().int().min(0),
      overloadedDays: z.number().int().min(0),
      computedAt: InstantSchema,
    })
    .nullable()
    .default(null),
});
export type WeeklyReviewSummary = z.infer<typeof WeeklyReviewSummarySchema>;

/**
 * A weekly review. `reviewWeekStart` is the Monday of the local week being
 * reviewed and `targetWeekStart` the Monday after it, both frozen when the
 * review starts: resuming weeks later keeps the same periods. `revision`
 * increments on every write so two windows cannot overwrite each other's
 * progress. `currentStep` is an identifier, never a position.
 */
export const WeeklyReviewSchema = BaseRecordSchema.extend({
  reviewWeekStart: LocalDateSchema,
  targetWeekStart: LocalDateSchema,
  flowVersion: z.number().int().min(1).default(1),
  revision: z.number().int().min(1).default(1),
  status: WeeklyReviewStatusSchema.default('inProgress'),
  currentStep: WeeklyReviewStepSchema.default('inbox'),
  steps: z.array(WeeklyReviewStepOutcomeSchema).max(7).default([]),
  stepDraft: WeeklyReviewStepDraftSchema.nullable().default(null),
  startedAt: InstantSchema,
  pausedAt: nullableInstant,
  completedAt: nullableInstant,
  summary: WeeklyReviewSummarySchema.nullable().default(null),
}).superRefine((review, ctx) => {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (review.targetWeekStart <= review.reviewWeekStart)
    issue('targetWeekStart', 'the target week follows the reviewed week');
  if (review.status === 'completed' && review.completedAt === null)
    issue('completedAt', 'a completed review records when');
  if (review.status !== 'completed' && review.completedAt !== null)
    issue('completedAt', 'only a completed review has a completion time');
  const seen = new Set<string>();
  for (const s of review.steps) {
    if (seen.has(s.step)) issue('steps', `step ${s.step} recorded twice`);
    seen.add(s.step);
  }
});
export type WeeklyReview = z.infer<typeof WeeklyReviewSchema>;

/** Every decision kind a receipt can record. */
export const WeeklyReviewActionKindSchema = z.enum([
  'convert-capture',
  'archive-capture',
  'triage-task',
  'defer',
  'acknowledge',
  'reschedule-task',
  'inbox-task',
  'archive-task',
  'complete-task',
  'set-next-action',
  'create-next-action',
  'edit-project',
  'archive-project',
  'update-goal',
  'goal-status',
  'area-target',
  'pay-bill',
  'edit-bill',
  'stop-bill',
  'finish',
]);
export type WeeklyReviewActionKind = z.infer<typeof WeeklyReviewActionKindSchema>;

/**
 * A durable receipt for one submitted review action. Its id is the action
 * UUID the UI generated on submit, which is the idempotency key: a retry
 * with the same id, review, and payload returns the stored `result` and
 * repeats nothing. Receipts are immutable history after commit; a later
 * correction is a new receipt that names the earlier one in `supersedes`.
 */
export const WeeklyReviewActionSchema = BaseRecordSchema.extend({
  reviewId: IdSchema,
  step: WeeklyReviewStepSchema,
  kind: WeeklyReviewActionKindSchema,
  /** The records the action concerned (before it ran). */
  refs: z.array(ReviewRefSchema).max(50).default([]),
  /** Fingerprint of the reviewed sources at submission. */
  fingerprint: z.string().default(''),
  /** The user's choice or target, as submitted. */
  choice: z.record(z.unknown()).default({}),
  /** Compact outcome: ids created, statuses set. Never a copy of the records. */
  result: z.record(z.unknown()).default({}),
  at: InstantSchema,
  supersedes: nullableId,
});
export type WeeklyReviewAction = z.infer<typeof WeeklyReviewActionSchema>;
