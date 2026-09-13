/**
 * Deterministic world generator. Benchmarks, data-safety jobs, and fixture
 * files all need "a realistic amount of data that is the same every run";
 * this is the one place that produces it. Ids come from the seeded PRNG so
 * two runs with the same seed yield byte-identical records.
 */
import type { Clock } from './clock';
import { fixedClock, nowIso } from './clock';
import { addDays, toLocalDate } from './dates';
import { createRecord } from './records';
import {
  APP_SETTINGS_ID,
  AppSettingsSchema,
  AreaSchema,
  BillSchema,
  BlockSchema,
  CaptureSchema,
  CommitmentSchema,
  DayCommitmentSchema,
  EventSchema,
  GoalSchema,
  InsightStateSchema,
  LinkSchema,
  MilestoneSchema,
  NoteSchema,
  PersonSchema,
  ProjectSchema,
  RoutineInstanceSchema,
  RoutineSchema,
  RuleSchema,
  SessionSchema,
  TaskSchema,
} from './schema';
import type {
  AppSettings,
  Area,
  Bill,
  Block,
  Capture,
  Commitment,
  DayCommitment,
  Energy,
  Event,
  Goal,
  Id,
  InsightState,
  Link,
  Milestone,
  Note,
  Person,
  Project,
  Reminder,
  Routine,
  RoutineInstance,
  Rule,
  Session,
  Task,
} from './schema';

export interface SeedSizes {
  areas: number;
  goals: number;
  projects: number;
  tasks: number;
  notes: number;
  people: number;
  events: number;
  /** Days of session history to generate, backwards from the clock. */
  days: number;
}

export const DEFAULT_SEED_SIZES: SeedSizes = {
  areas: 4,
  goals: 8,
  projects: 12,
  tasks: 200,
  notes: 40,
  people: 10,
  events: 20,
  days: 30,
};

export interface SeedWorld {
  areas: Area[];
  goals: Goal[];
  projects: Project[];
  milestones: Milestone[];
  tasks: Task[];
  events: Event[];
  routines: Routine[];
  routineInstances: RoutineInstance[];
  notes: Note[];
  people: Person[];
  commitments: Commitment[];
  bills: Bill[];
  blocks: Block[];
  dayCommitments: DayCommitment[];
  sessions: Session[];
  rules: Rule[];
  insightStates: InsightState[];
  captures: Capture[];
  reminders: Reminder[];
  appSettings: AppSettings[];
  links: Link[];
}

export interface SeedOptions {
  seed?: number;
  sizes?: Partial<SeedSizes>;
  /** The "now" records are stamped with. Default 2026-09-12 09:00 local. */
  clock?: Clock;
}

/** Mulberry32 PRNG: small, fast, deterministic. */
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

const HEX = '0123456789abcdef';

/** A UUID-shaped id (version 7 nibble, RFC variant) drawn from the PRNG. */
export function seededId(rng: () => number): Id {
  const hex = (n: number) => {
    let s = '';
    for (let i = 0; i < n; i++) s += HEX[Math.floor(rng() * 16)];
    return s;
  };
  return `${hex(8)}-${hex(4)}-7${hex(3)}-${HEX[8 + Math.floor(rng() * 4)]}${hex(3)}-${hex(12)}`;
}

const AREA_NAMES = ['Health', 'Study', 'Work', 'Home', 'Money', 'Relationships', 'Craft', 'Play'];
const VERBS = ['Write', 'Review', 'Call', 'Plan', 'Read', 'Fix', 'Draft', 'Send', 'Book', 'Clean'];
const NOUNS = [
  'the intro',
  'chapter two',
  'the budget',
  'the proposal',
  'the garage',
  'the slides',
  'test results',
  'the contract',
  'the invoice',
  'flash cards',
];
const ENERGIES: Energy[] = ['low', 'medium', 'high'];

export function seedWorld(options: SeedOptions = {}): SeedWorld {
  const rng = seededRandom(options.seed ?? 1);
  const sizes: SeedSizes = { ...DEFAULT_SEED_SIZES, ...options.sizes };
  const base = options.clock ?? fixedClock(new Date(2026, 8, 12, 9, 0, 0));
  const nowDate = base.now();
  const today = toLocalDate(nowDate);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  /** A clock some days in the past so createdAt/updatedAt vary. */
  const ago = (days: number) => fixedClock(new Date(nowDate.getTime() - days * 86_400_000));
  const make = <S extends Parameters<typeof createRecord>[0]>(
    schema: S,
    clock: Clock,
    fields: Omit<Parameters<typeof createRecord<S>>[2], 'id'>,
  ) =>
    createRecord(schema, clock, { ...fields, id: seededId(rng) } as Parameters<
      typeof createRecord<S>
    >[2]);

  const areas = Array.from({ length: sizes.areas }, (_, i) =>
    make(AreaSchema, ago(sizes.days + 5), {
      name: AREA_NAMES[i % AREA_NAMES.length]! + (i >= AREA_NAMES.length ? ` ${i}` : ''),
      weeklyHoursTarget: int(2, 12),
    }),
  );
  const goals = Array.from({ length: sizes.goals }, (_, i) =>
    make(GoalSchema, ago(sizes.days + 4), {
      title: `Goal ${i + 1}`,
      areaId: areas[i % areas.length]!.id,
      importance: int(1, 5),
      targetDate: rng() < 0.5 ? addDays(today, int(30, 200)) : null,
    }),
  );
  const projects = Array.from({ length: sizes.projects }, (_, i) => {
    const goal = goals[i % goals.length]!;
    return make(ProjectSchema, ago(sizes.days + 3), {
      title: `Project ${i + 1}`,
      areaId: goal.areaId,
      goalId: rng() < 0.8 ? goal.id : null,
      deadline: rng() < 0.6 ? addDays(today, int(-3, 60)) : null,
    });
  });
  const milestones: Milestone[] = [];
  for (const p of projects) {
    const n = int(2, 5);
    for (let k = 0; k < n; k++) {
      milestones.push(
        make(MilestoneSchema, ago(sizes.days + 2), {
          projectId: p.id,
          title: `Milestone ${k + 1}`,
          order: k,
          done: k < n / 2,
        }),
      );
    }
  }

  const tasks: Task[] = [];
  for (let i = 0; i < sizes.tasks; i++) {
    const project = rng() < 0.85 ? pick(projects) : null;
    const created = ago(int(0, sizes.days));
    const r = rng();
    const status = r < 0.55 ? 'open' : r < 0.85 ? 'done' : r < 0.95 ? 'inbox' : 'archived';
    const dependsOn =
      status === 'open' && tasks.length > 5 && rng() < 0.15
        ? [pick(tasks.filter((t) => t.status === 'open').slice(-20)) ?? tasks[0]!].map((t) => t.id)
        : [];
    tasks.push(
      make(TaskSchema, created, {
        title: `${pick(VERBS)} ${pick(NOUNS)} ${i + 1}`,
        projectId: project?.id ?? null,
        areaId: project ? project.areaId : pick(areas).id,
        status,
        priority: int(1, 3),
        estimateMin: pick([15, 30, 30, 45, 60, 90, 120, 180]),
        energy: pick(ENERGIES),
        dueAt:
          rng() < 0.4 ? new Date(nowDate.getTime() + int(-5, 40) * 86_400_000).toISOString() : null,
        dependsOn: dependsOn.filter((id) => id !== undefined),
        completedAt: status === 'done' ? nowIso(created) : null,
      }),
    );
  }
  for (const p of projects) {
    const first = tasks.find((t) => t.projectId === p.id && t.status === 'open');
    if (first) p.nextActionTaskId = first.id;
  }

  const events = Array.from({ length: sizes.events }, (_, i) => {
    const day = int(-sizes.days, 14);
    const start = new Date(nowDate.getTime() + day * 86_400_000);
    start.setHours(int(8, 16), pick([0, 30]), 0, 0);
    const end = new Date(start.getTime() + pick([30, 60, 90]) * 60_000);
    return make(EventSchema, ago(sizes.days), {
      title: `Meeting ${i + 1}`,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
    });
  });

  const routines = [
    make(RoutineSchema, ago(sizes.days), {
      title: 'Morning run',
      recurrence: { freq: 'weekly', byDay: ['MO', 'WE', 'FR'] },
      durationMin: 45,
      energy: 'high',
      preferredWindow: { startMin: 420, endMin: 540 },
      areaId: areas[0]!.id,
    }),
    make(RoutineSchema, ago(sizes.days), {
      title: 'Review inbox',
      recurrence: { freq: 'daily' },
      durationMin: 15,
      energy: 'low',
      preferredWindow: null,
      areaId: null,
    }),
  ];
  const routineInstances: RoutineInstance[] = [];
  for (let d = -7; d <= 0; d++) {
    for (const r of routines) {
      routineInstances.push(
        make(RoutineInstanceSchema, ago(-d), {
          routineId: r.id,
          date: addDays(today, d),
          status: d < 0 ? (rng() < 0.7 ? 'done' : 'skipped') : 'planned',
        }),
      );
    }
  }

  const notes = Array.from({ length: sizes.notes }, (_, i) => {
    const project = rng() < 0.6 ? pick(projects) : null;
    return make(NoteSchema, ago(int(0, sizes.days)), {
      title: `Note ${i + 1}`,
      body: `Some thoughts about ${pick(NOUNS)}.\n`.repeat(int(1, 12)),
      projectId: project?.id ?? null,
      areaId: project?.areaId ?? null,
    });
  });
  const people = Array.from({ length: sizes.people }, (_, i) =>
    make(PersonSchema, ago(sizes.days), { name: `Person ${i + 1}` }),
  );
  const commitments = people.map((p, i) =>
    make(CommitmentSchema, ago(int(0, 10)), {
      personId: p.id,
      text: `Send ${pick(NOUNS)} to ${p.name}`,
      dueAt:
        rng() < 0.5 ? new Date(nowDate.getTime() + int(-2, 10) * 86_400_000).toISOString() : null,
      status: i % 4 === 3 ? 'done' : 'open',
      direction: i % 3 === 0 ? 'owed-to-me' : 'owed-by-me',
    }),
  );
  const bills = Array.from({ length: Math.max(3, Math.floor(sizes.people / 2)) }, (_, i) =>
    make(BillSchema, ago(20), {
      title: `Bill ${i + 1}`,
      amount: int(10, 400),
      currency: 'USD',
      dueAt: addDays(today, int(-5, 30)),
      paid: rng() < 0.3,
    }),
  );

  const sessions: Session[] = [];
  const blocks: Block[] = [];
  const dayCommitments: DayCommitment[] = [];
  const openOrDone = tasks.filter((t) => t.status === 'open' || t.status === 'done');
  for (let d = sizes.days; d >= 1; d--) {
    const dayClock = ago(d);
    const date = addDays(today, -d);
    const n = int(1, 4);
    const chosen: Id[] = [];
    let cursor = 540;
    for (let k = 0; k < n && openOrDone.length; k++) {
      const t = pick(openOrDone);
      const len = pick([30, 45, 60, 90]);
      const start = new Date(dayClock.now());
      start.setHours(Math.floor(cursor / 60), cursor % 60, 0, 0);
      const end = new Date(start.getTime() + len * 60_000);
      sessions.push(
        make(SessionSchema, dayClock, {
          taskId: t.id,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
        }),
      );
      blocks.push(
        make(BlockSchema, dayClock, {
          date,
          startMin: cursor,
          endMin: cursor + len,
          taskId: t.id,
          locked: rng() < 0.2,
          source: 'planner',
        }),
      );
      chosen.push(t.id);
      cursor += len + 15;
    }
    dayCommitments.push(
      make(DayCommitmentSchema, dayClock, {
        date,
        acceptedTaskIds: chosen,
        energy: pick(ENERGIES),
        acceptedAt: nowIso(dayClock),
      }),
    );
  }

  const rules: Rule[] = [
    make(RuleSchema, ago(sizes.days), {
      type: 'constraint',
      name: 'No deep work late',
      config: { kind: 'noHighEnergyAfter', afterMin: 960 },
    }),
    make(RuleSchema, ago(sizes.days), {
      type: 'rollover',
      name: 'Rollover',
      config: { p1: 'tomorrow', p2: 'tomorrow', p3: 'nextWeek' },
    }),
    make(RuleSchema, ago(sizes.days), {
      type: 'reminder',
      name: 'Bills',
      config: { kind: 'billDueWithin', days: 5 },
    }),
  ] as Rule[];
  // One row per suppression mode (week 11), so exports and restores carry all of them.
  const insightStates = [
    make(InsightStateSchema, ago(2), { insightKey: 'neglected-goal:demo', snoozedUntil: null }),
    make(InsightStateSchema, ago(1), {
      insightKey: `stale-project:${projects[0]!.id}`,
      snoozedUntil: new Date(nowDate.getTime() + 6 * 86_400_000).toISOString(),
      dismissedAt: null,
      snoozeMode: 'time',
      lastSummary: {
        version: 1,
        kind: 'stale-project',
        severity: 'attention',
        title: `${projects[0]!.title} has had no recorded activity for 12 days.`,
        detail: '',
        subject: { type: 'project', id: projects[0]!.id },
        metrics: { staleDays: 12, thresholdDays: 10 },
      },
    }),
    make(InsightStateSchema, ago(1), {
      insightKey: `estimate-bias:area:${areas[0]!.id}`,
      snoozedUntil: null,
      dismissedAt: null,
      snoozeMode: 'change',
      suppressedFingerprint: '0123456789abcdef',
      lastSummary: {
        version: 1,
        kind: 'estimate-bias',
        severity: 'attention',
        title: `Work recorded in ${areas[0]!.name} took 1.40× the estimated time across 8 completed tasks.`,
        detail: '',
        subject: { type: 'area', id: areas[0]!.id },
        metrics: { ratio: 1.4, samples: 8 },
      },
    }),
    make(InsightStateSchema, ago(3), {
      insightKey: `overloaded-day:${addDays(today, 2)}`,
      snoozedUntil: null,
      dismissedAt: ago(3).now().toISOString(),
      lastSummary: {
        version: 1,
        kind: 'overloaded-day',
        severity: 'risk',
        title:
          'Wednesday has 555 minutes of committed work and 495 minutes of available work time.',
        detail: '',
        subject: { type: 'date', date: addDays(today, 2) },
        metrics: { demandMin: 555, availableMin: 495 },
      },
    }),
  ];
  const captures = Array.from({ length: Math.min(10, Math.ceil(sizes.tasks / 20)) }, (_, i) =>
    make(CaptureSchema, ago(0), {
      text: `Idea ${i + 1}: ${pick(VERBS).toLowerCase()} ${pick(NOUNS)}`,
      type: 'note',
      confidence: 0.6,
    }),
  );
  const links: Link[] = [];
  for (const n of notes) {
    if (n.projectId && rng() < 0.5) {
      links.push(
        make(LinkSchema, ago(1), {
          fromType: 'project',
          fromId: n.projectId,
          toType: 'note',
          toId: n.id,
        }),
      );
    }
  }

  return {
    areas,
    goals,
    projects,
    milestones,
    tasks,
    events,
    routines,
    routineInstances,
    notes,
    people,
    commitments,
    bills,
    blocks,
    dayCommitments,
    sessions,
    rules,
    insightStates,
    captures,
    reminders: [],
    // The settings document keeps its fixed id so every adapter can `get` it.
    appSettings: [
      createRecord(AppSettingsSchema, ago(sizes.days), {
        id: APP_SETTINGS_ID,
        workingWindow: { startMin: 540, endMin: 1080 },
        restBoundaries: [{ startMin: 750, endMin: 795 }],
        // A custom threshold so a round trip proves the group survives.
        insights: { staleProjectDays: 14 },
      }),
    ],
    links,
  };
}

/** Total record count across every store. */
export function seedCount(world: SeedWorld): number {
  return Object.values(world).reduce((n, rows) => n + rows.length, 0);
}
