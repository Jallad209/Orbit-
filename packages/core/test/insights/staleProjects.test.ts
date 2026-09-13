import { describe, expect, it } from 'vitest';
import { anArea, aMilestone, aSession, aTask } from '../builders';
import { NOW, clockAt, daysAgo, ofKind, run } from './helpers';
import { buildProjectActivity, computeProjectHealth } from '../../src/services';
import { fixedClock } from '../../src/clock';
import { createRecord } from '../../src/records';
import { ProjectSchema, type Project } from '../../src/schema';

const area = anArea({ name: 'Work' });

/** A project whose own record last changed `ago` days before NOW. */
function projectFrom(ago: number, fields: Partial<Project> = {}): Project {
  return createRecord(ProjectSchema, fixedClock(daysAgo(ago)), {
    title: 'Website redesign',
    areaId: area.id,
    ...fields,
  });
}

describe('stale projects', () => {
  it('reports at exactly ten complete days, not just before', () => {
    const almost = projectFrom(9.99);
    expect(ofKind(run({ areas: [area], projects: [almost] }), 'stale-project')).toEqual([]);
    const exactly = projectFrom(10);
    const [insight] = ofKind(run({ areas: [area], projects: [exactly] }), 'stale-project');
    expect(insight).toMatchObject({
      key: `stale-project:${exactly.id}`,
      severity: 'attention',
      subject: { type: 'project', id: exactly.id },
      threshold: { metric: 'staleDays', actual: 10, operator: '>=', limit: 10, unit: 'days' },
      metrics: { staleDays: 10, thresholdDays: 10 },
    });
    expect(insight!.title).toBe('Website redesign has had no recorded activity for 10 days.');
    expect(insight!.evidence).toEqual([
      {
        kind: 'activity',
        ref: { type: 'project', id: exactly.id },
        title: null,
        at: exactly.updatedAt,
        deleted: false,
        elapsedDays: 10,
      },
    ]);
  });

  it('honours a changed threshold', () => {
    const project = projectFrom(4);
    expect(
      ofKind(
        run({ areas: [area], projects: [project] }, { settings: { staleProjectDays: 4 } }),
        'stale-project',
      ),
    ).toHaveLength(1);
    expect(
      ofKind(
        run({ areas: [area], projects: [project] }, { settings: { staleProjectDays: 5 } }),
        'stale-project',
      ),
    ).toEqual([]);
  });

  it('counts task, milestone, session, and deletion activity through the shared definition', () => {
    const project = projectFrom(20);
    const task = { ...aTask({ title: 'Old task', projectId: project.id }), updatedAt: daysAgo(15) };
    const milestone = {
      ...aMilestone({ projectId: project.id, title: 'M' }),
      updatedAt: daysAgo(12),
    };
    const session = aSession({ taskId: task.id, startAt: daysAgo(3), endAt: daysAgo(2.9) });
    const tombstone = {
      ...aTask({ title: 'Dropped', projectId: project.id }),
      updatedAt: daysAgo(1),
      deletedAt: daysAgo(1),
    };

    const withTask = run({ areas: [area], projects: [project], tasks: [task] });
    expect(withTask.insights[0]?.metrics.staleDays).toBe(15);
    const withMilestone = run({
      areas: [area],
      projects: [project],
      tasks: [task],
      milestones: [milestone],
    });
    expect(withMilestone.insights[0]?.metrics.staleDays).toBe(12);
    const withSession = run({
      areas: [area],
      projects: [project],
      tasks: [task],
      sessions: [session],
    });
    expect(ofKind(withSession, 'stale-project')).toEqual([]);
    const withDeletion = run({ areas: [area], projects: [project], tasks: [task, tombstone] });
    expect(ofKind(withDeletion, 'stale-project')).toEqual([]);
    // The tombstone is activity only: the project's task counts ignore it.
    const health = computeProjectHealth(project, {
      tasks: [task, tombstone],
      milestones: [],
      now: NOW,
    });
    expect(health.openTasks).toBe(1);
    expect(health.lastActivity).toMatchObject({
      source: { type: 'task', id: tombstone.id, deleted: true },
    });
  });

  it('only judges live, active projects; a project with no children uses its own history', () => {
    const completed = projectFrom(30, { status: 'completed' });
    const archived = projectFrom(30, { status: 'archived' });
    const deleted = { ...projectFrom(30), deletedAt: daysAgo(1) };
    const lonely = projectFrom(11);
    const report = run({ areas: [area], projects: [completed, archived, deleted, lonely] });
    expect(ofKind(report, 'stale-project').map((i) => i.subject)).toEqual([
      { type: 'project', id: lonely.id },
    ]);
    expect(report.coverage.find((c) => c.kind === 'stale-project')).toMatchObject({
      subjects: 1,
      emitted: 1,
    });
  });

  it('agrees with project health, tells when the next project turns stale, and clamps the future', () => {
    const fresh = projectFrom(3);
    const future = projectFrom(-2);
    const report = run({ areas: [area], projects: [fresh, future] });
    expect(ofKind(report, 'stale-project')).toEqual([]);
    expect(report.boundaries.nextStaleAt).toBe(
      new Date(new Date(fresh.updatedAt).getTime() + 10 * 86_400_000).toISOString(),
    );
    const activity = buildProjectActivity({ projects: [fresh, future], tasks: [] });
    for (const p of [fresh, future]) {
      const health = computeProjectHealth(p, { tasks: [], milestones: [], now: NOW, activity });
      expect(health.stale).toBe(false);
      expect(health.staleDays).toBeGreaterThanOrEqual(0);
    }
    // Later: the badge and the insight flip together.
    const later = clockAt(new Date(NOW.getTime() + 8 * 86_400_000));
    const then = run({ areas: [area], projects: [fresh, future] }, { clock: later });
    expect(ofKind(then, 'stale-project').map((i) => i.subject)).toEqual([
      { type: 'project', id: fresh.id },
    ]);
    expect(
      computeProjectHealth(fresh, { tasks: [], milestones: [], now: later.now(), activity }).stale,
    ).toBe(true);
  });

  it('keeps its fingerprint while only time passes and changes it on activity', () => {
    const project = projectFrom(12);
    const a = run({ areas: [area], projects: [project] });
    const b = run(
      { areas: [area], projects: [project] },
      { clock: clockAt(new Date(NOW.getTime() + 86_400_000)) },
    );
    expect(b.insights[0]?.metrics.staleDays).toBe(13);
    expect(b.insights[0]?.fingerprint).toBe(a.insights[0]?.fingerprint);
    const touched = { ...project, updatedAt: daysAgo(11) };
    const c = run({ areas: [area], projects: [touched] });
    expect(c.insights[0]?.fingerprint).not.toBe(a.insights[0]?.fingerprint);
  });
});
