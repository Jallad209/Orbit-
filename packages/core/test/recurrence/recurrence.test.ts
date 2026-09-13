import { describe, expect, it } from 'vitest';
import {
  INSTANCE_WINDOW_DAYS,
  applyRecurringRules,
  expandRecurrence,
  instanceWindow,
  markInstance,
  materializeInstances,
  occursOn,
  planDay,
  startOfWeek,
} from '../../src';
import { createRecord } from '../../src/records';
import { RoutineInstanceSchema, RuleSchema } from '../../src/schema';
import { aRoutine, aWorld, testClock } from '../builders';

const clock = testClock(); // Sat 12 Sep 2026

describe('expandRecurrence', () => {
  it('daily with an interval, count, and until', () => {
    const r = {
      freq: 'daily' as const,
      interval: 2,
      byDay: [],
      byMonthDay: null,
      count: null,
      until: null,
    };
    expect(expandRecurrence(r, '2026-09-01', { from: '2026-09-01', to: '2026-09-08' })).toEqual([
      '2026-09-01',
      '2026-09-03',
      '2026-09-05',
      '2026-09-07',
    ]);
    expect(
      expandRecurrence({ ...r, count: 2 }, '2026-09-01', { from: '2026-09-01', to: '2026-09-30' }),
    ).toEqual(['2026-09-01', '2026-09-03']);
    expect(
      expandRecurrence({ ...r, until: '2026-09-04' }, '2026-09-01', {
        from: '2026-09-01',
        to: '2026-09-30',
      }),
    ).toEqual(['2026-09-01', '2026-09-03']);
  });

  it('weekly by day, only from the anchor onwards, every other week', () => {
    const r = {
      freq: 'weekly' as const,
      interval: 1,
      byDay: ['MO' as const, 'WE' as const, 'FR' as const],
      byMonthDay: null,
      count: null,
      until: null,
    };
    // Anchor Wednesday 9 Sep: Monday 7 Sep is skipped.
    expect(expandRecurrence(r, '2026-09-09', { from: '2026-09-07', to: '2026-09-18' })).toEqual([
      '2026-09-09',
      '2026-09-11',
      '2026-09-14',
      '2026-09-16',
      '2026-09-18',
    ]);
    expect(
      expandRecurrence({ ...r, interval: 2, byDay: ['MO'] }, '2026-09-07', {
        from: '2026-09-07',
        to: '2026-10-05',
      }),
    ).toEqual(['2026-09-07', '2026-09-21', '2026-10-05']);
    expect(startOfWeek('2026-09-13')).toBe('2026-09-07'); // Sunday belongs to the week before
    expect(startOfWeek('2026-09-14')).toBe('2026-09-14');
  });

  it('monthly on the 31st lands on the last day of short months', () => {
    const r = {
      freq: 'monthly' as const,
      interval: 1,
      byDay: [],
      byMonthDay: 31,
      count: null,
      until: null,
    };
    expect(expandRecurrence(r, '2026-08-31', { from: '2026-08-01', to: '2027-03-31' })).toEqual([
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ]);
    expect(occursOn(r, '2026-08-31', '2026-09-30')).toBe(true);
    expect(occursOn(r, '2026-08-31', '2026-09-29')).toBe(false);
  });
});

describe('routine instances', () => {
  it('materializes the rolling window and never regenerates a skipped instance', () => {
    const routine = aRoutine(
      { title: 'Run', recurrence: { freq: 'daily' as const }, startDate: '2026-09-12' },
      clock,
    );
    const window = instanceWindow(clock.now());
    expect(window).toEqual({ from: '2026-09-12', to: '2026-10-09' });
    const first = materializeInstances([routine], [], window, clock);
    expect(first).toHaveLength(INSTANCE_WINDOW_DAYS);

    const skipped = markInstance(first[1]!, 'skipped');
    const deleted = { ...first[2]!, deletedAt: '2026-09-12T10:00:00.000Z' };
    const again = materializeInstances([routine], [first[0]!, skipped, deleted], window, clock);
    expect(again).toHaveLength(INSTANCE_WINDOW_DAYS - 3);
    expect(again.map((i) => i.date)).not.toContain('2026-09-13');
    expect(again.map((i) => i.date)).not.toContain('2026-09-14');
  });

  it('a weekly rule produces exactly N instances across the week, and the planner places them', () => {
    const w = aWorld(clock);
    const exercise = aRoutine(
      { title: 'Exercise', recurrence: { freq: 'weekly', byDay: [] }, durationMin: 45 },
      clock,
    );
    const rule = createRecord(RuleSchema, clock, {
      type: 'recurring',
      config: { routineId: exercise.id, timesPerWeek: 3 },
    });
    // Monday 14 Sep, nothing yet this week.
    const made = applyRecurringRules([rule], [exercise], [], '2026-09-14', clock);
    expect(made.map((i) => i.date)).toEqual(['2026-09-14', '2026-09-16', '2026-09-18']);

    // One already done on Tuesday: only two more, and never on a day that has one.
    const done = createRecord(RoutineInstanceSchema, clock, {
      routineId: exercise.id,
      date: '2026-09-15',
      status: 'done',
    });
    const more = applyRecurringRules([rule], [exercise], [done], '2026-09-16', clock);
    expect(more).toHaveLength(2);
    expect(more.map((i) => i.date)).toEqual(['2026-09-16', '2026-09-18']);

    // Satisfied weeks add nothing; disabled rules add nothing.
    expect(applyRecurringRules([rule], [exercise], [...made], '2026-09-14', clock)).toEqual([]);
    expect(
      applyRecurringRules([{ ...rule, enabled: false }], [exercise], [], '2026-09-14', clock),
    ).toEqual([]);

    const p = planDay(
      { ...w, routines: [exercise], routineInstances: made },
      '2026-09-14',
      {},
      clock,
    );
    expect(p.blocks.filter((b) => b.kind === 'routine')).toHaveLength(1);
  });
});
