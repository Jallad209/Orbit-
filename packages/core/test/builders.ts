/**
 * Fixture builders for engine tests. Every builder returns a fully valid
 * record with sensible defaults; pass overrides for what the test cares about.
 * `seededRandom` gives deterministic pseudo-random data for benchmarks.
 */
import type { z } from 'zod';
import { fixedClock, type FixedClock } from '../src/clock';
import { createRecord } from '../src/records';
import {
  AreaSchema,
  BillSchema,
  BlockSchema,
  CommitmentSchema,
  EventSchema,
  GoalSchema,
  LinkSchema,
  MilestoneSchema,
  NoteSchema,
  PersonSchema,
  ProjectSchema,
  RoutineSchema,
  SessionSchema,
  TaskSchema,
} from '../src/schema';
import type { BaseRecord } from '../src/schema';

export const DEFAULT_NOW = new Date(2026, 8, 12, 9, 0, 0); // Sat 12 Sep 2026 09:00 local

export function testClock(at: Date | string = DEFAULT_NOW): FixedClock {
  return fixedClock(at);
}

type Fields<S extends z.ZodTypeAny> = Omit<z.input<S>, keyof BaseRecord> &
  Partial<Pick<BaseRecord, 'id'>>;

function builder<S extends z.ZodTypeAny>(schema: S, defaults: () => Fields<S>) {
  return (overrides: Partial<Fields<S>> = {}, clock: FixedClock = testClock()): z.output<S> =>
    createRecord(schema, clock, { ...defaults(), ...overrides } as Fields<S>);
}

let n = 0;
const next = (label: string) => `${label} ${++n}`;

export const anArea = builder(AreaSchema, () => ({ name: next('Area') }));
export const aGoal = builder(GoalSchema, () => ({ title: next('Goal'), areaId: anArea().id }));
export const aProject = builder(ProjectSchema, () => ({
  title: next('Project'),
  areaId: anArea().id,
}));
export const aMilestone = builder(MilestoneSchema, () => ({
  title: next('Milestone'),
  projectId: aProject().id,
}));
export const aTask = builder(TaskSchema, () => ({ title: next('Task'), status: 'open' as const }));
export const anEvent = builder(EventSchema, () => ({
  title: next('Event'),
  startAt: '2026-09-14T09:00:00.000Z',
  endAt: '2026-09-14T10:00:00.000Z',
}));
export const aRoutine = builder(RoutineSchema, () => ({
  title: next('Routine'),
  recurrence: { freq: 'weekly' as const, byDay: ['MO' as const] },
}));
export const aNote = builder(NoteSchema, () => ({ title: next('Note') }));
export const aPerson = builder(PersonSchema, () => ({ name: next('Person') }));
export const aCommitment = builder(CommitmentSchema, () => ({
  text: next('Commitment'),
  personId: aPerson().id,
}));
export const aBill = builder(BillSchema, () => ({
  title: next('Bill'),
  amount: 10,
  dueAt: '2026-10-01',
}));
export const aBlock = builder(BlockSchema, () => ({
  date: '2026-09-14',
  startMin: 540,
  endMin: 600,
}));
export const aSession = builder(SessionSchema, () => ({
  taskId: aTask().id,
  startAt: '2026-09-11T09:00:00.000Z',
  endAt: '2026-09-11T09:30:00.000Z',
}));
export const aLink = builder(LinkSchema, () => ({
  fromType: 'task' as const,
  fromId: aTask().id,
  toType: 'note' as const,
  toId: aNote().id,
}));

/** Mulberry32: tiny deterministic PRNG for seeded fixtures. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small connected world: 2 areas, 3 goals, 4 projects, tasks with milestones. */
export function aWorld(clock: FixedClock = testClock()) {
  const health = anArea({ name: 'Health', weeklyHoursTarget: 4 }, clock);
  const study = anArea({ name: 'Study', weeklyHoursTarget: 10 }, clock);
  const run = aGoal({ title: 'Run a half marathon', areaId: health.id, importance: 4 }, clock);
  const graduate = aGoal({ title: 'Graduate', areaId: study.id, importance: 5 }, clock);
  const spanish = aGoal({ title: 'Learn Spanish', areaId: study.id, importance: 2 }, clock);
  const thesis = aProject(
    { title: 'Thesis', areaId: study.id, goalId: graduate.id, deadline: '2026-12-01' },
    clock,
  );
  const plan = aProject({ title: 'Training plan', areaId: health.id, goalId: run.id }, clock);
  const vocab = aProject({ title: 'Vocabulary', areaId: study.id, goalId: spanish.id }, clock);
  const garage = aProject({ title: 'Clean the garage', areaId: health.id }, clock);
  const m1 = aMilestone({ projectId: thesis.id, title: 'Outline', done: true, order: 0 }, clock);
  const m2 = aMilestone({ projectId: thesis.id, title: 'Draft', order: 1 }, clock);
  const m3 = aMilestone({ projectId: thesis.id, title: 'Revise', order: 2 }, clock);
  const m4 = aMilestone({ projectId: thesis.id, title: 'Submit', order: 3 }, clock);
  const intro = aTask(
    { title: 'Write intro', projectId: thesis.id, areaId: study.id, estimateMin: 90 },
    clock,
  );
  const lit = aTask(
    { title: 'Literature review', projectId: thesis.id, areaId: study.id, estimateMin: 240 },
    clock,
  );
  const method = aTask(
    {
      title: 'Methods chapter',
      projectId: thesis.id,
      areaId: study.id,
      dependsOn: [intro.id, lit.id],
    },
    clock,
  );
  const done = aTask(
    { title: 'Pick a topic', projectId: thesis.id, areaId: study.id, status: 'done' },
    clock,
  );
  const shoes = aTask({ title: 'Buy running shoes', projectId: plan.id, areaId: health.id }, clock);
  const week1 = aTask(
    { title: 'Week 1 runs', projectId: plan.id, areaId: health.id, dependsOn: [shoes.id] },
    clock,
  );
  const cards = aTask({ title: 'Make flash cards', projectId: vocab.id, areaId: study.id }, clock);
  const sweep = aTask({ title: 'Sweep', projectId: garage.id, areaId: health.id }, clock);
  return {
    areas: [health, study],
    goals: [run, graduate, spanish],
    projects: [{ ...thesis, nextActionTaskId: intro.id }, plan, vocab, garage],
    milestones: [m1, m2, m3, m4],
    tasks: [intro, lit, method, done, shoes, week1, cards, sweep],
    ids: {
      health,
      study,
      run,
      graduate,
      spanish,
      thesis,
      plan,
      vocab,
      garage,
      intro,
      lit,
      method,
      done,
      shoes,
      week1,
      cards,
      sweep,
    },
  };
}
