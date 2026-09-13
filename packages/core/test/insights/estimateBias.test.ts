import { describe, expect, it } from 'vitest';
import { anArea, aProject, aSession, aTask } from '../builders';
import { NOW, clockAt, daysAgo, ofKind, reversed, run, snapshotWith } from './helpers';
import { computeInsights, DEFAULT_INSIGHT_SETTINGS } from '../../src/insights';
import type { Task } from '../../src/schema';

const area = anArea({ name: 'University' });
const project = aProject({ title: 'Thesis', areaId: area.id });

function done(estimateMin: number, actualMin: number | null, ago = 3): Task {
  return aTask({
    title: `Task ${estimateMin}/${actualMin}`,
    projectId: project.id,
    areaId: area.id,
    status: 'done',
    estimateMin,
    actualMin,
    completedAt: daysAgo(ago),
  });
}

describe('estimate bias', () => {
  it('needs five valid samples: four say insufficient data, five compare', () => {
    const four = [done(60, 90), done(60, 90), done(60, 90), done(60, 90)];
    const short = run({ areas: [area], projects: [project], tasks: four });
    expect(ofKind(short, 'estimate-bias')).toEqual([]);
    expect(short.coverage.find((c) => c.kind === 'estimate-bias')).toMatchObject({
      subjects: 1,
      eligible: 0,
      available: false,
      unavailableReason: 'insufficient-samples',
      requiredSamples: 5,
      largestSample: 4,
    });

    const five = [...four, done(60, 90)];
    const report = run({ areas: [area], projects: [project], tasks: five });
    const [insight] = ofKind(report, 'estimate-bias');
    expect(insight).toMatchObject({
      key: `estimate-bias:area:${area.id}`,
      severity: 'attention',
      subject: { type: 'area', id: area.id },
      threshold: {
        metric: 'actual/estimate',
        operator: '>',
        limit: 1.3,
        sampleSize: 5,
        minSamples: 5,
      },
      metrics: { ratio: 1.5, samples: 5, estimateMin: 300, actualMin: 450, windowDays: 30 },
    });
    expect(insight!.title).toBe(
      'Work recorded in University took 1.50× the estimated time across 5 completed tasks.',
    );
    expect(insight!.evidence).toHaveLength(5);
    expect(insight!.evidence[0]).toMatchObject({ kind: 'task-actual', actualSource: 'actualMin' });
  });

  it('is strict at the threshold: exactly 1.3 is quiet, just above reports', () => {
    const exact = Array.from({ length: 5 }, () => done(100, 130));
    expect(
      ofKind(run({ areas: [area], projects: [project], tasks: exact }), 'estimate-bias'),
    ).toEqual([]);
    const above = [...exact.slice(0, 4), done(100, 131)];
    expect(
      ofKind(run({ areas: [area], projects: [project], tasks: above }), 'estimate-bias'),
    ).toHaveLength(1);
  });

  it('sums minutes before dividing rather than averaging per-task ratios', () => {
    // Four tiny tasks at 3× and one long task on time: 4×(10→30) + (400→400) = 520/440 = 1.18.
    const tasks = [done(10, 30), done(10, 30), done(10, 30), done(10, 30), done(400, 400)];
    const report = run({ areas: [area], projects: [project], tasks });
    expect(ofKind(report, 'estimate-bias')).toEqual([]);
  });

  it('prefers an explicit actual, including zero, over sessions; falls back to closed sessions', () => {
    const explicitZero = done(60, 0);
    const bySessions = done(60, null);
    const running = done(60, null);
    const future = done(60, null);
    const sessions = [
      aSession({ taskId: explicitZero.id, startAt: daysAgo(4), endAt: daysAgo(3.9) }),
      aSession({ taskId: bySessions.id, startAt: daysAgo(4), endAt: daysAgo(3.9) }), // 144 min
      aSession({ taskId: running.id, startAt: daysAgo(4), endAt: null }),
      aSession({ taskId: future.id, startAt: daysAgo(-0.25), endAt: daysAgo(-0.5) }),
    ];
    const tasks = [explicitZero, bySessions, running, future, done(60, 60), done(60, 60)];
    const report = run({ areas: [area], projects: [project], tasks, sessions });
    const [insight] = ofKind(report, 'estimate-bias');
    // running and future-session tasks are not samples: 4 samples < 5 → nothing reported
    expect(insight).toBeUndefined();
    const withOneMore = run({
      areas: [area],
      projects: [project],
      tasks: [...tasks, done(60, 60)],
      sessions,
    });
    const [i2] = ofKind(withOneMore, 'estimate-bias');
    expect(i2).toBeUndefined(); // 0+144+60+60+60 = 324 / 300 = 1.08
    const coverage = withOneMore.coverage.find((c) => c.kind === 'estimate-bias')!;
    expect(coverage).toMatchObject({ eligible: 1, available: true, largestSample: 5 });
  });

  it('ignores zero estimates, missing actuals, future and out-of-window completions', () => {
    const tasks = [
      done(0, 90),
      done(60, null),
      done(60, 90, -1), // completed in the future
      done(60, 90, 31), // outside the 30-day window
      done(60, 90, 30), // exactly 30 days ago: inclusive
      done(60, 90),
      done(60, 90),
      done(60, 90),
      done(60, 90),
    ];
    const report = run({ areas: [area], projects: [project], tasks });
    const [insight] = ofKind(report, 'estimate-bias');
    expect(insight?.metrics.samples).toBe(5);
    expect(insight?.range).toEqual({ from: '2026-08-15', to: '2026-09-14' });
  });

  it('groups work with no live area as Unassigned instead of borrowing an area', () => {
    const gone = anArea({ name: 'Old' });
    const tasks = Array.from({ length: 5 }, () =>
      aTask({
        title: 'Orphan',
        areaId: gone.id,
        status: 'done',
        estimateMin: 30,
        actualMin: 60,
        completedAt: daysAgo(2),
      }),
    );
    const report = run({ areas: [area], tasks });
    const [insight] = ofKind(report, 'estimate-bias');
    expect(insight).toMatchObject({
      key: 'estimate-bias:unassigned',
      subject: { type: 'unassigned' },
    });
    expect(insight!.title).toContain('Unassigned');
  });

  it('skips deleted tasks and is stable under input reordering', () => {
    const tasks = [
      ...Array.from({ length: 6 }, () => done(60, 120)),
      { ...done(60, 999), deletedAt: daysAgo(1) },
    ];
    const snapshot = snapshotWith({ areas: [area], projects: [project], tasks });
    const input = {
      snapshot,
      settings: DEFAULT_INSIGHT_SETTINGS,
      planning: {
        workingWindow: { startMin: 540, endMin: 1080 },
        restBoundaries: [],
        defaultEstimateMin: 30,
      },
      clock: clockAt(),
    };
    const a = computeInsights(input);
    const b = computeInsights({ ...input, snapshot: reversed(snapshot) });
    expect(a.insights).toEqual(b.insights);
    expect(a.insights[0]?.metrics.samples).toBe(6);
  });

  it('reports the instant the oldest sample leaves the window, and time alone keeps the fingerprint', () => {
    const tasks = Array.from({ length: 5 }, (_, i) => done(60, 120, 10 + i));
    const first = run({ areas: [area], projects: [project], tasks });
    const oldest = new Date(NOW.getTime() - 14 * 86_400_000);
    expect(first.boundaries.nextSampleExpiryAt).toBe(
      new Date(oldest.getTime() + 30 * 86_400_000 + 1).toISOString(),
    );
    const later = run(
      { areas: [area], projects: [project], tasks },
      { clock: clockAt(new Date(NOW.getTime() + 5 * 86_400_000)) },
    );
    expect(later.insights[0]?.fingerprint).toBe(first.insights[0]?.fingerprint);
    // Editing a sample's recorded time is a source change.
    const edited = tasks.map((t, i) => (i === 0 ? { ...t, actualMin: 121 } : t));
    const changed = run({ areas: [area], projects: [project], tasks: edited });
    expect(changed.insights[0]?.fingerprint).not.toBe(first.insights[0]?.fingerprint);
  });
});
