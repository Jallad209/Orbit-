import { describe, expect, it } from 'vitest';
import { aBlock, anEvent, aRoutine, aTask } from '../builders';
import { NOW, PLANNING, TODAY, clockAt, ofKind, run, snapshotWith } from './helpers';
import { fixedClock } from '../../src/clock';
import { addDays, toInstant } from '../../src/dates';
import {
  DEFAULT_INSIGHT_SETTINGS,
  buildInsightIndex,
  computeDayLoad,
  fullDayCapacity,
  unionMinutes,
} from '../../src/insights';
import { createRecord } from '../../src/records';
import {
  DayCommitmentSchema,
  RoutineInstanceSchema,
  RuleSchema,
  type Block,
  type Rule,
} from '../../src/schema';

const WED = addDays(TODAY, 2); // 2026-09-16

function block(startMin: number, endMin: number, fields: Partial<Block> = {}) {
  return aBlock({ date: WED, startMin, endMin, ...fields });
}

function reserve(
  fields: Partial<Extract<Rule, { type: 'constraint' }>['config']> & { areaId?: string | null },
) {
  return createRecord(RuleSchema, clockAt(), {
    type: 'constraint',
    name: 'Reserved',
    config: {
      kind: 'reserve',
      dayOfWeek: 'WE',
      startMin: 540,
      endMin: 600,
      areaId: null,
      ...fields,
    },
  });
}

describe('full-day capacity', () => {
  it('is the working window minus rest, events, and whole reservations, overlaps once', () => {
    const lunchOverlap = anEvent({
      title: 'Lunch meeting',
      startAt: toInstant(WED, 740).toISOString(),
      endAt: toInstant(WED, 810).toISOString(),
    });
    const early = anEvent({
      title: 'Dentist',
      startAt: toInstant(WED, 480).toISOString(), // 08:00, before the window
      endAt: toInstant(WED, 570).toISOString(),
    });
    const capacity = fullDayCapacity(
      WED,
      PLANNING,
      [reserve({ startMin: 1020, endMin: 1140 })],
      [lunchOverlap, early],
    );
    // window 540: rest 750–795 ∪ meeting 740–810 = 70; dentist clipped 540–570 = 30; reserve clipped 1020–1080 = 60.
    expect(capacity).toMatchObject({ windowMin: 540, excludedMin: 160, availableMin: 380 });
    expect(capacity.exclusions.map((e) => [e.kind, e.startMin, e.endMin])).toEqual([
      ['event', 540, 570],
      ['event', 740, 810],
      ['rest', 750, 795],
      ['reserve', 1020, 1080],
    ]);
  });

  it('keeps area reservations as usable time with their label, and ignores energy rules', () => {
    const area = reserve({
      startMin: 600,
      endMin: 720,
      areaId: '019372a0-0000-7000-8000-000000000001',
      label: 'Deep work',
    });
    const energy = createRecord(RuleSchema, clockAt(), {
      type: 'constraint',
      name: 'No deep work late',
      config: { kind: 'noHighEnergyAfter', afterMin: 900 },
    });
    const capacity = fullDayCapacity(WED, PLANNING, [area, energy], []);
    expect(capacity.availableMin).toBe(495);
    expect(capacity.areaReservations).toEqual([
      {
        ruleId: area.id,
        areaId: '019372a0-0000-7000-8000-000000000001',
        label: 'Deep work',
        startMin: 600,
        endMin: 720,
      },
    ]);
  });

  it('ignores disabled and other-weekday reservations', () => {
    const off = { ...reserve({ startMin: 540, endMin: 1080 }), enabled: false };
    const monday = reserve({ dayOfWeek: 'MO', startMin: 540, endMin: 1080 });
    expect(fullDayCapacity(WED, PLANNING, [off, monday], []).availableMin).toBe(495);
  });

  it('unionMinutes counts overlaps once', () => {
    expect(
      unionMinutes([
        { startMin: 0, endMin: 10 },
        { startMin: 5, endMin: 15 },
        { startMin: 20, endMin: 25 },
      ]),
    ).toBe(20);
    expect(unionMinutes([])).toBe(0);
  });
});

describe('day demand', () => {
  const task = aTask({ title: 'Write report', estimateMin: 60 });
  const doneTask = aTask({ title: 'Done already', status: 'done', estimateMin: 30 });
  const archived = aTask({ title: 'Archived', status: 'archived' });
  const routine = aRoutine({ title: 'Stretch' });
  const instance = createRecord(RoutineInstanceSchema, clockAt(), {
    routineId: routine.id,
    date: WED,
  });
  const skipped = createRecord(RoutineInstanceSchema, clockAt(), {
    routineId: routine.id,
    date: WED,
    status: 'skipped',
  });
  const event = anEvent({
    title: 'Standup',
    startAt: toInstant(WED, 600).toISOString(),
    endAt: toInstant(WED, 630).toISOString(),
  });

  function load(parts: Parameters<typeof snapshotWith>[0], settings = DEFAULT_INSIGHT_SETTINGS) {
    const snapshot = snapshotWith(parts);
    return computeDayLoad(WED, snapshot, buildInsightIndex(snapshot, NOW), PLANNING, settings);
  }

  it('counts task, routine, manual, done, split, and out-of-window blocks by their own length', () => {
    const blocks = [
      block(540, 600, { taskId: task.id }),
      block(900, 960, { taskId: task.id }), // second part of a split: its own duration, not the estimate again
      block(600, 630, { eventId: event.id }), // the event already reduced capacity
      block(630, 660, { routineInstanceId: instance.id }),
      block(660, 690, { routineInstanceId: skipped.id }),
      block(700, 730, { source: 'manual' }),
      block(800, 830, { taskId: doneTask.id }),
      block(840, 870, { taskId: archived.id }),
      block(1080, 1140, { taskId: task.id }), // after the window
      block(1140, 1170, { taskId: task.id, deletedAt: null }),
    ];
    const day = load({
      tasks: [task, doneTask, archived],
      routines: [routine],
      routineInstances: [instance, skipped],
      blocks,
      events: [event],
    });
    expect(day.blocks.map((b) => [b.source, b.minutes, b.outsideWindow, b.finished])).toEqual([
      ['task', 60, false, false],
      ['routine', 30, false, false],
      ['manual', 30, false, false],
      ['task', 30, false, true],
      ['task', 60, false, false],
      ['task', 60, true, false],
      ['task', 30, true, false],
    ]);
    expect(day.demandMin).toBe(300);
    expect(day.capacity.availableMin).toBe(465); // 495 − standup
  });

  it('adds an accepted task without a block once, with the planner rounding and default estimate', () => {
    const zero = aTask({ title: 'No estimate', estimateMin: 0 });
    const odd = aTask({ title: 'Seven minutes', estimateMin: 7 });
    const c1 = createRecord(DayCommitmentSchema, clockAt(), {
      date: WED,
      acceptedTaskIds: [task.id, zero.id, odd.id],
      acceptedAt: NOW.toISOString(),
    });
    const c2 = createRecord(DayCommitmentSchema, clockAt(), {
      date: WED,
      acceptedTaskIds: [zero.id, doneTask.id],
      acceptedAt: NOW.toISOString(),
    });
    const day = load({
      tasks: [task, zero, odd, doneTask],
      dayCommitments: [c1, c2],
      blocks: [block(540, 600, { taskId: task.id })],
    });
    expect(day.unscheduled.map((u) => [u.title, u.estimateMin, u.minutes])).toEqual(
      expect.arrayContaining([
        ['No estimate', 0, 30],
        ['Seven minutes', 7, 15],
      ]),
    );
    expect(day.unscheduled).toHaveLength(2); // task has a block; done task is not unfinished; zero counted once
    expect(day.demandMin).toBe(60 + 30 + 15);
  });

  it('keeps a commitment whose blocks were removed visible as accepted-unscheduled', () => {
    const commitment = createRecord(DayCommitmentSchema, clockAt(), {
      date: WED,
      acceptedTaskIds: [task.id],
      acceptedAt: NOW.toISOString(),
    });
    const removed = { ...block(540, 600, { taskId: task.id }), deletedAt: NOW.toISOString() };
    const day = load({ tasks: [task], dayCommitments: [commitment], blocks: [removed] });
    expect(day.blocks).toEqual([]);
    expect(day.unscheduled).toMatchObject([
      { ref: { type: 'task', id: task.id }, minutes: 60, commitmentId: commitment.id },
    ]);
  });

  it('sums overlapping blocks instead of merging them', () => {
    const other = aTask({ title: 'Other', estimateMin: 60 });
    const day = load({
      tasks: [task, other],
      blocks: [block(540, 600, { taskId: task.id }), block(560, 620, { taskId: other.id })],
    });
    expect(day.demandMin).toBe(120);
  });
});

describe('overloaded days', () => {
  const task = aTask({ title: 'Big task', estimateMin: 60 });

  function booked(minutes: number) {
    // Several blocks summing to `minutes`, all inside the window (may overlap: they add up).
    const blocks: Block[] = [];
    let left = minutes;
    let start = 540;
    while (left > 0) {
      const len = Math.min(left, 120);
      blocks.push(block(start, start + len, { taskId: task.id }));
      left -= len;
      start = Math.min(start + len, 900);
    }
    return blocks;
  }

  it('is quiet at exactly 110% and reports just above', () => {
    // Capacity 495: 544.5 is exactly 110%; blocks are whole minutes, so 544 and 545.
    expect(ofKind(run({ tasks: [task], blocks: booked(544) }), 'overloaded-day')).toEqual([]);
    const [insight] = ofKind(run({ tasks: [task], blocks: booked(555) }), 'overloaded-day');
    expect(insight).toMatchObject({
      key: `overloaded-day:${WED}`,
      severity: 'risk',
      subject: { type: 'date', date: WED },
      range: { from: WED, to: WED },
      metrics: { demandMin: 555, availableMin: 495, blocks: 5, unscheduled: 0 },
      threshold: { metric: 'committed/available', operator: '>', limit: 1.1, unit: 'ratio' },
    });
    expect(insight!.title).toBe(
      'Wednesday has 555 minutes of committed work and 495 minutes of available work time.',
    );
    expect(insight!.threshold.actual).toBeCloseTo(555 / 495, 6);
    expect(insight!.notes[0]).toMatch(/^Workload comparison only/);
    expect(insight!.evidence.at(-1)).toMatchObject({ kind: 'capacity', availableMin: 495 });
    // The evidence reconciles to the totals.
    const counted = insight!.evidence
      .filter((e) => e.kind === 'block')
      .reduce((s, e) => s + (e as { minutes: number }).minutes, 0);
    expect(counted).toBe(555);
  });

  it('handles zero capacity without Infinity: quiet when nothing is booked, plain words otherwise', () => {
    const allDay = reserve({ startMin: 540, endMin: 1080 });
    expect(ofKind(run({ rules: [allDay] }), 'overloaded-day')).toEqual([]);
    const [insight] = ofKind(
      run({ rules: [allDay], tasks: [task], blocks: booked(120) }),
      'overloaded-day',
    );
    expect(insight!.title).toBe(
      'Wednesday has 120 minutes of committed work and no available work time.',
    );
    expect(insight!.threshold).toMatchObject({
      metric: 'committedMin',
      actual: 120,
      limit: 0,
      unit: 'minutes',
    });
    expect(JSON.stringify(insight)).not.toMatch(/Infinity|NaN/);
    expect(insight!.metrics.ratio).toBeUndefined();
  });

  it('does not change with the time of day, and only looks seven dates ahead', () => {
    const blocks = booked(555);
    const morning = run(
      { tasks: [task], blocks },
      { clock: fixedClock(new Date(2026, 8, 14, 8, 0)) },
    );
    const evening = run(
      { tasks: [task], blocks },
      { clock: fixedClock(new Date(2026, 8, 14, 20, 0)) },
    );
    expect(morning.insights.map((i) => [i.key, i.metrics])).toEqual(
      evening.insights.map((i) => [i.key, i.metrics]),
    );
    expect(morning.insights[0]?.fingerprint).toBe(evening.insights[0]?.fingerprint);

    const far = blocks.map((b) => ({ ...b, date: addDays(TODAY, 7) }));
    expect(ofKind(run({ tasks: [task], blocks: far }), 'overloaded-day')).toEqual([]);
    const edge = blocks.map((b) => ({ ...b, date: addDays(TODAY, 6) }));
    expect(ofKind(run({ tasks: [task], blocks: edge }), 'overloaded-day')).toHaveLength(1);
    expect(run({}).coverage.find((c) => c.kind === 'overloaded-day')).toMatchObject({
      subjects: 7,
      emitted: 0,
      available: true,
    });
  });

  it('respects the configured ratio', () => {
    const blocks = booked(500);
    expect(ofKind(run({ tasks: [task], blocks }), 'overloaded-day')).toEqual([]);
    expect(
      ofKind(
        run({ tasks: [task], blocks }, { settings: { dayOverloadRatio: 1 } }),
        'overloaded-day',
      ),
    ).toHaveLength(1);
  });
});
