import { describe, expect, it } from 'vitest';
import { aBlock, aCommitment, anArea, aPerson, aProject, aTask } from '../builders';
import { NOW, PLANNING, TODAY, clockAt, daysAgo, reversed, run, snapshotWith } from './helpers';
import { fixedClock } from '../../src/clock';
import { addDays, fromLocalDate } from '../../src/dates';
import {
  DEFAULT_INSIGHT_SETTINGS,
  INSIGHT_ALGORITHM_VERSION,
  compareInsights,
  computeInsights,
  fingerprint,
  canonical,
  type Insight,
} from '../../src/insights';
import { createRecord } from '../../src/records';
import { ProjectSchema } from '../../src/schema';

/** A world that trips every detector once. */
function busyWorld() {
  const area = anArea({ name: 'University', weeklyHoursTarget: 60 });
  const project = createRecord(ProjectSchema, fixedClock(daysAgo(12)), {
    title: 'Thesis',
    areaId: area.id,
  });
  const tasks = Array.from({ length: 5 }, (_, i) =>
    aTask({
      title: `Chapter ${i}`,
      projectId: project.id,
      status: 'done',
      estimateMin: 60,
      actualMin: 90,
      completedAt: daysAgo(2 + i),
    }),
  ).map((t) => ({ ...t, updatedAt: daysAgo(12) }));
  const work = aTask({ title: 'Booked', estimateMin: 60 });
  const wed = addDays(TODAY, 2);
  const blocks = [
    aBlock({ date: wed, startMin: 540, endMin: 660, taskId: work.id }),
    aBlock({ date: wed, startMin: 540, endMin: 660, taskId: work.id }),
    aBlock({ date: wed, startMin: 540, endMin: 660, taskId: work.id }),
    aBlock({ date: wed, startMin: 540, endMin: 660, taskId: work.id }),
    aBlock({ date: wed, startMin: 540, endMin: 660, taskId: work.id }),
  ];
  const sara = aPerson({ name: 'Sara' });
  const commitments = [1, 2, 3].map(() => aCommitment({ personId: sara.id }));
  return snapshotWith({
    areas: [area],
    projects: [project],
    tasks: [...tasks, work],
    blocks,
    people: [sara],
    commitments,
  });
}

describe('computeInsights', () => {
  it('runs every detector, sorts risk → attention → info with the documented detector order, and reports coverage', () => {
    const report = computeInsights({
      snapshot: busyWorld(),
      settings: DEFAULT_INSIGHT_SETTINGS,
      planning: PLANNING,
      clock: clockAt(),
    });
    expect(report.insights.map((i) => i.kind)).toEqual([
      'overloaded-day',
      'weekly-target-deficit',
      'stale-project',
      'estimate-bias',
      'person-commitments',
    ]);
    expect(report.insights.map((i) => i.severity)).toEqual([
      'risk',
      'risk',
      'attention',
      'attention',
      'info',
    ]);
    for (const i of report.insights) {
      expect(i.evidence.length).toBeGreaterThan(0);
      expect(i.computedAt).toBe(NOW.toISOString());
      expect(i.algorithmVersion).toBe(INSIGHT_ALGORITHM_VERSION);
      expect(i.fingerprint).toMatch(/^[0-9a-f]{16}$/);
      expect(i.key).not.toMatch(/\d\.\d/); // no ratios or counters in keys
    }
    expect(report.coverage.map((c) => [c.kind, c.emitted])).toEqual([
      ['overloaded-day', 1],
      ['weekly-target-deficit', 1],
      ['stale-project', 1],
      ['estimate-bias', 1],
      ['person-commitments', 1],
    ]);
    expect(report.today).toBe(TODAY);
    expect(report.boundaries.nextMidnightAt).toBe(fromLocalDate(addDays(TODAY, 1)).toISOString());
  });

  it('is deterministic: identical input gives identical output, and input order does not matter', () => {
    const snapshot = busyWorld();
    const input = {
      snapshot,
      settings: DEFAULT_INSIGHT_SETTINGS,
      planning: PLANNING,
      clock: clockAt(),
    };
    const a = computeInsights(input);
    const b = computeInsights(input);
    const c = computeInsights({ ...input, snapshot: reversed(snapshot) });
    expect(a).toEqual(b);
    expect(c.insights).toEqual(a.insights);
  });

  it('never writes: the snapshot is untouched', () => {
    const snapshot = busyWorld();
    const before = JSON.stringify(snapshot);
    computeInsights({
      snapshot,
      settings: DEFAULT_INSIGHT_SETTINGS,
      planning: PLANNING,
      clock: clockAt(),
    });
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('survives dangling references without crashing', () => {
    const project = aProject({ title: 'Orphan', areaId: '019372a0-0000-7000-8000-00000000dead' });
    const task = aTask({ title: 'Ref', projectId: '019372a0-0000-7000-8000-00000000dead' });
    const block = aBlock({
      date: TODAY,
      startMin: 540,
      endMin: 600,
      taskId: '019372a0-0000-7000-8000-00000000dead',
    });
    const instanceBlock = aBlock({
      date: TODAY,
      startMin: 540,
      endMin: 600,
      routineInstanceId: '019372a0-0000-7000-8000-00000000dead',
    });
    const report = run({ projects: [project], tasks: [task], blocks: [block, instanceBlock] });
    expect(report.insights.filter((i) => i.kind === 'overloaded-day')).toEqual([]);
    expect(report.coverage).toHaveLength(5);
  });

  it('orders dated subjects by date and equal ranks by key', () => {
    const mk = (
      kind: Insight['kind'],
      severity: Insight['severity'],
      key: string,
      subject: Insight['subject'],
    ): Insight => ({
      key,
      kind,
      severity,
      title: '',
      detail: '',
      subject,
      evidence: [],
      threshold: {
        metric: '',
        actual: 0,
        operator: '>',
        limit: 0,
        unit: 'count',
        sampleSize: null,
        minSamples: null,
      },
      metrics: {},
      range: null,
      notes: [],
      computedAt: '',
      fingerprint: '',
      algorithmVersion: 1,
    });
    const list = [
      mk('person-commitments', 'info', 'person-commitments:b', { type: 'person', id: 'b' }),
      mk('overloaded-day', 'risk', 'overloaded-day:2026-09-18', {
        type: 'date',
        date: '2026-09-18',
      }),
      mk('stale-project', 'attention', 'stale-project:a', { type: 'project', id: 'a' }),
      mk('overloaded-day', 'risk', 'overloaded-day:2026-09-15', {
        type: 'date',
        date: '2026-09-15',
      }),
      mk('estimate-bias', 'attention', 'estimate-bias:area:a', { type: 'area', id: 'a' }),
      mk('weekly-target-deficit', 'risk', 'weekly-target-deficit:2026-09-21', {
        type: 'week',
        weekStart: '2026-09-21',
      }),
      mk('person-commitments', 'info', 'person-commitments:a', { type: 'person', id: 'a' }),
    ];
    expect([...list].sort(compareInsights).map((i) => i.key)).toEqual([
      'overloaded-day:2026-09-15',
      'overloaded-day:2026-09-18',
      'weekly-target-deficit:2026-09-21',
      'stale-project:a',
      'estimate-bias:area:a',
      'person-commitments:a',
      'person-commitments:b',
    ]);
  });
});

describe('fingerprint', () => {
  it('is canonical over key order and sensitive to values', () => {
    expect(canonical({ b: 1, a: [2, { d: 3, c: null }] })).toBe('{"a":[2,{"c":null,"d":3}],"b":1}');
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
    expect(fingerprint('x')).toMatch(/^[0-9a-f]{16}$/);
  });
});
