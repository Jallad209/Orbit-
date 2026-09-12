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

/** v1 "expense" is a bill: an amount with a due date. */
export const BillSchema = BaseRecordSchema.extend({
  title,
  amount: z.number().min(0),
  currency: z.string().default(''),
  dueAt: LocalDateSchema,
  recurrence: RecurrenceSchema.nullable().default(null),
  paid: z.boolean().default(false),
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
export const RolloverConfigSchema = z.object({
  p1: RolloverTargetSchema.default('tomorrow'),
  p2: RolloverTargetSchema.default('tomorrow'),
  p3: RolloverTargetSchema.default('nextWeek'),
});

export const ReminderConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('billDueWithin'), days: z.number().int().min(0).max(60) }),
  z.object({ kind: z.literal('followUpAfter'), days: z.number().int().min(1).max(365) }),
]);

export const RuleSchema = z.discriminatedUnion('type', [
  RuleBase.extend({ type: z.literal('constraint'), config: ConstraintConfigSchema }),
  RuleBase.extend({
    type: z.literal('recurring'),
    config: z.object({ routineId: IdSchema, timesPerWeek: z.number().int().min(1).max(7) }),
  }),
  RuleBase.extend({ type: z.literal('rollover'), config: RolloverConfigSchema }),
  RuleBase.extend({ type: z.literal('reminder'), config: ReminderConfigSchema }),
]);
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

export const InsightStateSchema = BaseRecordSchema.extend({
  insightKey: z.string().min(1),
  snoozedUntil: nullableInstant,
  dismissedAt: nullableInstant,
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
