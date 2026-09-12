import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  AreaSchema,
  BillSchema,
  BlockSchema,
  CommitmentSchema,
  DayCommitmentSchema,
  EventSchema,
  GoalSchema,
  InsightStateSchema,
  LinkSchema,
  MilestoneSchema,
  NoteSchema,
  OpLogEntrySchema,
  PersonSchema,
  ProjectSchema,
  RoutineInstanceSchema,
  RoutineSchema,
  RuleSchema,
  SessionSchema,
  TaskSchema,
} from '../src/schema';
import { fixedClock } from '../src/clock';
import { createRecord } from '../src/records';
import { newId } from '../src/ids';

const clock = fixedClock('2026-09-12T09:00:00.000Z');
const AT = '2026-09-12T09:00:00.000Z';
const base = () => ({ id: newId(), createdAt: AT, updatedAt: AT, deletedAt: null });
const id = () => newId();

/** [name, schema, minimal valid input, required keys to knock out one at a time] */
const cases: Array<[string, z.ZodTypeAny, Record<string, unknown>, string[]]> = [
  ['Area', AreaSchema, { ...base(), name: 'Health' }, ['name']],
  ['Goal', GoalSchema, { ...base(), title: 'Run 5k', areaId: id() }, ['title', 'areaId']],
  ['Project', ProjectSchema, { ...base(), title: 'Thesis', areaId: id() }, ['title', 'areaId']],
  [
    'Milestone',
    MilestoneSchema,
    { ...base(), projectId: id(), title: 'Draft' },
    ['projectId', 'title'],
  ],
  ['Task', TaskSchema, { ...base(), title: 'Write intro' }, ['title']],
  [
    'Event',
    EventSchema,
    { ...base(), title: 'Standup', startAt: AT, endAt: '2026-09-12T09:30:00.000Z' },
    ['title', 'startAt', 'endAt'],
  ],
  [
    'Routine',
    RoutineSchema,
    { ...base(), title: 'Gym', recurrence: { freq: 'weekly', byDay: ['MO', 'WE'] } },
    ['title', 'recurrence'],
  ],
  [
    'RoutineInstance',
    RoutineInstanceSchema,
    { ...base(), routineId: id(), date: '2026-09-14' },
    ['routineId', 'date'],
  ],
  ['Note', NoteSchema, { ...base(), title: 'Idea' }, ['title']],
  ['Person', PersonSchema, { ...base(), name: 'Omar' }, ['name']],
  [
    'Commitment',
    CommitmentSchema,
    { ...base(), personId: id(), text: 'Send the slides' },
    ['personId', 'text'],
  ],
  [
    'Bill',
    BillSchema,
    { ...base(), title: 'Electricity', amount: 120, dueAt: '2026-10-01' },
    ['title', 'amount', 'dueAt'],
  ],
  [
    'Block',
    BlockSchema,
    { ...base(), date: '2026-09-12', startMin: 540, endMin: 600, taskId: id() },
    ['date', 'startMin', 'endMin'],
  ],
  [
    'DayCommitment',
    DayCommitmentSchema,
    { ...base(), date: '2026-09-12', acceptedAt: AT },
    ['date', 'acceptedAt'],
  ],
  ['Session', SessionSchema, { ...base(), taskId: id(), startAt: AT }, ['taskId', 'startAt']],
  [
    'Link',
    LinkSchema,
    { ...base(), fromType: 'task', fromId: id(), toType: 'note', toId: id() },
    ['fromType', 'fromId', 'toType', 'toId'],
  ],
  ['InsightState', InsightStateSchema, { ...base(), insightKey: 'stale:abc' }, ['insightKey']],
  [
    'OpLogEntry',
    OpLogEntrySchema,
    { seq: 1, entity: 'task', entityId: id(), op: 'create', patch: {}, at: AT },
    ['seq', 'entity', 'entityId', 'op', 'at'],
  ],
];

describe('entity schemas', () => {
  for (const [name, schema, valid, required] of cases) {
    describe(name, () => {
      it('accepts a minimal valid record', () => {
        expect(schema.safeParse(valid).success).toBe(true);
      });
      for (const key of required) {
        it(`rejects a record missing "${key}"`, () => {
          const broken: Record<string, unknown> = { ...valid };
          delete broken[key];
          expect(schema.safeParse(broken).success).toBe(false);
        });
      }
    });
  }

  it('applies defaults', () => {
    const task = TaskSchema.parse({ ...base(), title: 'x' });
    expect(task.status).toBe('inbox');
    expect(task.priority).toBe(2);
    expect(task.estimateMin).toBe(30);
    expect(task.energy).toBe('medium');
    expect(task.dependsOn).toEqual([]);
    expect(task.deletedAt).toBeNull();
  });

  it('rejects an id that is not a UUID', () => {
    expect(AreaSchema.safeParse({ ...base(), id: 'nope', name: 'x' }).success).toBe(false);
  });

  it('rejects an impossible calendar date', () => {
    expect(
      BillSchema.safeParse({ ...base(), title: 'x', amount: 1, dueAt: '2026-02-30' }).success,
    ).toBe(false);
  });
});

describe('Task', () => {
  it('cannot depend on itself', () => {
    const self = newId();
    const result = TaskSchema.safeParse({ ...base(), id: self, title: 'x', dependsOn: [self] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['dependsOn']);
    }
  });

  it('can depend on other tasks', () => {
    const result = TaskSchema.safeParse({ ...base(), title: 'x', dependsOn: [newId(), newId()] });
    expect(result.success).toBe(true);
  });
});

describe('Block', () => {
  it('must end after it starts', () => {
    const r = BlockSchema.safeParse({ ...base(), date: '2026-09-12', startMin: 600, endMin: 600 });
    expect(r.success).toBe(false);
  });

  it('references at most one of task / routine instance / event', () => {
    const r = BlockSchema.safeParse({
      ...base(),
      date: '2026-09-12',
      startMin: 540,
      endMin: 600,
      taskId: id(),
      eventId: id(),
    });
    expect(r.success).toBe(false);
  });
});

describe('Event', () => {
  it('must end after it starts', () => {
    const r = EventSchema.safeParse({ ...base(), title: 'x', startAt: AT, endAt: AT });
    expect(r.success).toBe(false);
  });
});

describe('Rule discriminated union', () => {
  it('parses all four rule types', () => {
    const rules = [
      { ...base(), type: 'constraint', config: { kind: 'noHighEnergyAfter', afterMin: 19 * 60 } },
      {
        ...base(),
        type: 'constraint',
        config: { kind: 'reserve', dayOfWeek: 'FR', startMin: 18 * 60, endMin: 22 * 60 },
      },
      { ...base(), type: 'recurring', config: { routineId: id(), timesPerWeek: 3 } },
      { ...base(), type: 'rollover', config: {} },
      { ...base(), type: 'reminder', config: { kind: 'billDueWithin', days: 3 } },
      { ...base(), type: 'reminder', config: { kind: 'followUpAfter', days: 7 } },
    ];
    for (const rule of rules) {
      const r = RuleSchema.safeParse(rule);
      expect(r.success, JSON.stringify(rule)).toBe(true);
    }
    const rollover = RuleSchema.parse(rules[3]);
    if (rollover.type === 'rollover') {
      expect(rollover.config).toEqual({ p1: 'tomorrow', p2: 'tomorrow', p3: 'nextWeek' });
    }
  });

  it('rejects an unknown rule type', () => {
    expect(RuleSchema.safeParse({ ...base(), type: 'magic', config: {} }).success).toBe(false);
  });

  it('rejects a config that does not match the type', () => {
    expect(
      RuleSchema.safeParse({
        ...base(),
        type: 'recurring',
        config: { kind: 'billDueWithin', days: 3 },
      }).success,
    ).toBe(false);
  });
});

describe('createRecord', () => {
  it('stamps id and timestamps from the clock and applies defaults', () => {
    const task = createRecord(TaskSchema, clock, { title: 'Submit report' });
    expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(task.createdAt).toBe(AT);
    expect(task.updatedAt).toBe(AT);
    expect(task.deletedAt).toBeNull();
    expect(task.status).toBe('inbox');
  });

  it('throws on invalid fields', () => {
    expect(() => createRecord(TaskSchema, clock, { title: '   ' })).toThrow();
  });
});
