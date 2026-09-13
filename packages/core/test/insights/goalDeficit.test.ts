import { describe, expect, it } from 'vitest';
import { aGoal, anArea, anEvent } from '../builders';
import { TODAY, clockAt, ofKind, run } from './helpers';
import { addDays, toInstant } from '../../src/dates';
import { nextFullWeekStart } from '../../src/insights';
import { createRecord } from '../../src/records';
import { RuleSchema } from '../../src/schema';

// Next full week after Monday 14 Sep 2026 is Mon 21 – Sun 27 Sep: 7 × 495 = 3465 minutes.
const WEEK = '2026-09-21';

describe('weekly area-target deficit', () => {
  it('counts each area once whatever its goals, and includes areas with no active goal', () => {
    const study = anArea({ name: 'Study', weeklyHoursTarget: 40 });
    const health = anArea({ name: 'Health', weeklyHoursTarget: 20 });
    const zero = anArea({ name: 'Admin', weeklyHoursTarget: 0 });
    const goals = [
      aGoal({ areaId: study.id }),
      aGoal({ areaId: study.id }),
      aGoal({ areaId: study.id }),
    ];
    const report = run({ areas: [study, health, zero], goals });
    const [insight] = ofKind(report, 'weekly-target-deficit');
    expect(insight).toMatchObject({
      key: `weekly-target-deficit:${WEEK}`,
      severity: 'risk',
      title: 'Weekly area targets exceed available time.',
      subject: { type: 'week', weekStart: WEEK },
      range: { from: WEEK, to: '2026-09-27' },
      metrics: { requiredMin: 3600, availableMin: 3465, deficitMin: 135, areas: 2 },
      threshold: { actual: 135, operator: '>', limit: 0, unit: 'minutes' },
    });
    expect(insight!.evidence.filter((e) => e.kind === 'area-target')).toHaveLength(2);
    expect(
      insight!.evidence
        .filter((e) => e.kind === 'capacity')
        .map((e) => (e as { date: string }).date),
    ).toEqual(Array.from({ length: 7 }, (_, i) => addDays(WEEK, i)));
    expect(insight!.notes).toHaveLength(2);
  });

  it('is quiet with zero targets, or at exact equality', () => {
    expect(
      ofKind(run({ areas: [anArea({ weeklyHoursTarget: 0 })] }), 'weekly-target-deficit'),
    ).toEqual([]);
    expect(run({}).coverage.find((c) => c.kind === 'weekly-target-deficit')).toMatchObject({
      available: false,
      unavailableReason: 'no-targets',
    });
    // 3465 minutes = 57.75 hours exactly
    const exact = anArea({ weeklyHoursTarget: 57.75 });
    expect(ofKind(run({ areas: [exact] }), 'weekly-target-deficit')).toEqual([]);
    const over = anArea({ weeklyHoursTarget: 57.76 });
    expect(ofKind(run({ areas: [over] }), 'weekly-target-deficit')).toHaveLength(1);
  });

  it('uses the saved working window, and events, rest, and reservations in that week', () => {
    const area = anArea({ weeklyHoursTarget: 50 }); // 3000 minutes
    const wide = {
      workingWindow: { startMin: 480, endMin: 1200 },
      restBoundaries: [],
      defaultEstimateMin: 30,
    }; // 720 × 7 = 5040
    expect(ofKind(run({ areas: [area] }, { planning: wide }), 'weekly-target-deficit')).toEqual([]);
    const narrow = { ...wide, workingWindow: { startMin: 540, endMin: 900 } }; // 360 × 7 = 2520
    expect(
      ofKind(run({ areas: [area] }, { planning: narrow }), 'weekly-target-deficit'),
    ).toHaveLength(1);

    // A conference on Wednesday of that week removes a whole day of the wide window: 5040 − 720 = 4320, still fine…
    const conference = anEvent({
      title: 'Conference',
      startAt: toInstant('2026-09-23', 0).toISOString(),
      endAt: toInstant('2026-09-24', 0).toISOString(),
    });
    expect(
      ofKind(
        run({ areas: [area], events: [conference] }, { planning: wide }),
        'weekly-target-deficit',
      ),
    ).toEqual([]);
    // …until weekends are reserved off (Sat+Sun): 4320 − 1440 = 2880 < 3000.
    const weekendsOff = (['SA', 'SU'] as const).map((day) =>
      createRecord(RuleSchema, clockAt(), {
        type: 'constraint',
        name: 'Weekend',
        config: { kind: 'reserve', dayOfWeek: day, startMin: 480, endMin: 1200, areaId: null },
      }),
    );
    const [insight] = ofKind(
      run({ areas: [area], events: [conference], rules: weekendsOff }, { planning: wide }),
      'weekly-target-deficit',
    );
    expect(insight?.metrics).toMatchObject({ availableMin: 2880, deficitMin: 120 });
    // A disabled reservation gives the time back.
    const disabled = weekendsOff.map((r) => ({ ...r, enabled: false }));
    expect(
      ofKind(
        run({ areas: [area], events: [conference], rules: disabled }, { planning: wide }),
        'weekly-target-deficit',
      ),
    ).toEqual([]);
  });

  it('does not subtract area reservations: they are still the area’s time', () => {
    const area = anArea({ weeklyHoursTarget: 57.75 });
    const reserved = createRecord(RuleSchema, clockAt(), {
      type: 'constraint',
      name: 'Deep work',
      config: { kind: 'reserve', dayOfWeek: 'MO', startMin: 540, endMin: 720, areaId: area.id },
    });
    expect(ofKind(run({ areas: [area], rules: [reserved] }), 'weekly-target-deficit')).toEqual([]);
  });

  it('rolls to the next full week on Sunday night, keys the week, and ignores deleted areas', () => {
    const area = anArea({ weeklyHoursTarget: 100 });
    for (const [today, expected] of [
      [TODAY, '2026-09-21'],
      ['2026-09-20', '2026-09-21'],
      ['2026-09-21', '2026-09-28'],
    ] as const) {
      expect(nextFullWeekStart(today)).toBe(expected);
      const [insight] = ofKind(run({ areas: [area] }, { today }), 'weekly-target-deficit');
      expect(insight?.key).toBe(`weekly-target-deficit:${expected}`);
    }
    const gone = { ...area, deletedAt: new Date().toISOString() };
    expect(ofKind(run({ areas: [gone] }), 'weekly-target-deficit')).toEqual([]);
  });
});
