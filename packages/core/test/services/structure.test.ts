import { describe, expect, it } from 'vitest';
import {
  DependencyError,
  HierarchyError,
  ancestorsOfTask,
  archiveProjectCascade,
  assertAreaDeletable,
  blockers,
  computeAreaAttention,
  computeGoalAttention,
  computeProjectHealth,
  dependents,
  descendantsOfArea,
  findDuplicateLink,
  groupLinked,
  isReady,
  makeLink,
  resolveTaskParent,
  validateDependencies,
  validateProjectParent,
  wouldCreateCycle,
} from '../../src/services';
import { formatDuration, parseDuration } from '../../src/durations';
import { aLink, aNote, aPerson, aSession, aTask, aWorld, anArea, testClock } from '../builders';

describe('hierarchy', () => {
  it('resolves a task area from its project and rejects bad parents', () => {
    const w = aWorld();
    const t = resolveTaskParent({ projectId: w.ids.thesis.id, areaId: null }, w);
    expect(t.areaId).toBe(w.ids.study.id);
    expect(() => resolveTaskParent({ projectId: 'nope', areaId: null }, w)).toThrow(HierarchyError);
    const archived = {
      ...w,
      projects: w.projects.map((p) =>
        p.id === w.ids.garage.id ? { ...p, status: 'archived' as const } : p,
      ),
    };
    expect(() => resolveTaskParent({ projectId: w.ids.garage.id, areaId: null }, archived)).toThrow(
      /archived/,
    );
  });

  it('requires a project goal to be in the same area', () => {
    const w = aWorld();
    expect(() =>
      validateProjectParent({ areaId: w.ids.health.id, goalId: w.ids.graduate.id }, w),
    ).toThrow(/same area/);
    expect(() =>
      validateProjectParent({ areaId: w.ids.study.id, goalId: w.ids.graduate.id }, w),
    ).not.toThrow();
    expect(() => validateProjectParent({ areaId: 'missing', goalId: null }, w)).toThrow(
      HierarchyError,
    );
  });

  it('walks ancestors and descendants', () => {
    const w = aWorld();
    const anc = ancestorsOfTask(w.ids.intro, w);
    expect(anc.project?.id).toBe(w.ids.thesis.id);
    expect(anc.goal?.id).toBe(w.ids.graduate.id);
    expect(anc.area?.id).toBe(w.ids.study.id);
    const d = descendantsOfArea(w.ids.study.id, w);
    expect(d.goals.map((g) => g.title).sort()).toEqual(['Graduate', 'Learn Spanish']);
    expect(d.projects).toHaveLength(2);
    expect(d.tasks).toHaveLength(5);
  });

  it('archiving a project archives its open tasks and clears the next action', () => {
    const w = aWorld();
    const thesis = w.projects.find((p) => p.id === w.ids.thesis.id)!;
    const { project, tasks } = archiveProjectCascade(thesis, w);
    expect(project.status).toBe('archived');
    expect(project.nextActionTaskId).toBeNull();
    expect(tasks.map((t) => t.status)).toEqual(['archived', 'archived', 'archived']);
    expect(tasks.find((t) => t.title === 'Pick a topic')).toBeUndefined(); // done stays done
  });

  it('refuses to delete a non-empty area', () => {
    const w = aWorld();
    expect(() => assertAreaDeletable(w.ids.study.id, w)).toThrow(/still holds/);
    const empty = anArea();
    expect(() => assertAreaDeletable(empty.id, { ...w, areas: [...w.areas, empty] })).not.toThrow();
  });
});

describe('dependencies', () => {
  it('detects self, missing, and cycles', () => {
    const w = aWorld();
    expect(() => validateDependencies(w.ids.intro.id, [w.ids.intro.id], w.tasks)).toThrow(/itself/);
    expect(() => validateDependencies(w.ids.intro.id, ['ghost'], w.tasks)).toThrow(DependencyError);
    // method depends on intro; making intro depend on method is a loop.
    expect(wouldCreateCycle(w.ids.intro.id, [w.ids.method.id], w.tasks)).toBe(true);
    expect(() => validateDependencies(w.ids.intro.id, [w.ids.method.id], w.tasks)).toThrow(/loop/);
    expect(wouldCreateCycle(w.ids.intro.id, [w.ids.cards.id], w.tasks)).toBe(false);
  });

  it('reports readiness and blockers', () => {
    const w = aWorld();
    expect(isReady(w.ids.intro, w.tasks)).toBe(true);
    expect(isReady(w.ids.method, w.tasks)).toBe(false);
    expect(
      blockers(w.ids.method, w.tasks)
        .map((t) => t.title)
        .sort(),
    ).toEqual(['Literature review', 'Write intro']);
    const introDone = w.tasks.map((t) =>
      t.id === w.ids.intro.id ? { ...t, status: 'done' as const } : t,
    );
    expect(blockers(w.ids.method, introDone).map((t) => t.title)).toEqual(['Literature review']);
    expect(dependents(w.ids.shoes.id, w.tasks).map((t) => t.title)).toEqual(['Week 1 runs']);
  });
});

describe('project health', () => {
  const now = testClock().now();

  it('uses milestones when present, task completion otherwise, none when empty', () => {
    const w = aWorld();
    const thesis = w.projects.find((p) => p.id === w.ids.thesis.id)!;
    const h = computeProjectHealth(thesis, { milestones: w.milestones, tasks: w.tasks, now });
    expect(h.progress).toBe(0.25);
    expect(h.progressSource).toBe('milestones');
    expect(h.milestonesDone).toBe(1);
    expect(h.milestonesTotal).toBe(4);

    const plan = w.projects.find((p) => p.id === w.ids.plan.id)!;
    const hp = computeProjectHealth(plan, { milestones: w.milestones, tasks: w.tasks, now });
    expect(hp.progressSource).toBe('tasks');
    expect(hp.progress).toBe(0);

    const empty = computeProjectHealth({ ...plan, id: 'x' }, { milestones: [], tasks: [], now });
    expect(empty.progressSource).toBe('none');
    expect(empty.progress).toBe(0);
  });

  it('flags a project with open tasks but no valid next action', () => {
    const w = aWorld();
    const plan = w.projects.find((p) => p.id === w.ids.plan.id)!;
    expect(computeProjectHealth(plan, { milestones: [], tasks: w.tasks, now }).noNextAction).toBe(
      true,
    );
    const withNext = { ...plan, nextActionTaskId: w.ids.shoes.id };
    expect(
      computeProjectHealth(withNext, { milestones: [], tasks: w.tasks, now }).noNextAction,
    ).toBe(false);
    // A next action that is done no longer counts.
    const doneNext = w.tasks.map((t) =>
      t.id === w.ids.shoes.id ? { ...t, status: 'done' as const } : t,
    );
    expect(
      computeProjectHealth(withNext, { milestones: [], tasks: doneNext, now }).noNextAction,
    ).toBe(true);
  });

  it('flags blocked, stale, and overdue', () => {
    const w = aWorld();
    const plan = w.projects.find((p) => p.id === w.ids.plan.id)!;
    // Move "shoes" to another project: plan's only open task then waits on an unfinished task elsewhere → blocked.
    const onlyBlocked = w.tasks.map((t) =>
      t.id === w.ids.shoes.id ? { ...t, projectId: w.ids.garage.id } : t,
    );
    expect(computeProjectHealth(plan, { milestones: [], tasks: onlyBlocked, now }).blocked).toBe(
      true,
    );
    // An archived dependency no longer blocks.
    const archivedDep = w.tasks.map((t) =>
      t.id === w.ids.shoes.id ? { ...t, status: 'archived' as const } : t,
    );
    expect(computeProjectHealth(plan, { milestones: [], tasks: archivedDep, now }).blocked).toBe(
      false,
    );
    expect(computeProjectHealth(plan, { milestones: [], tasks: w.tasks, now }).blocked).toBe(false);

    const later = new Date(now.getTime() + 12 * 86_400_000);
    const h = computeProjectHealth(plan, { milestones: [], tasks: w.tasks, now: later });
    expect(h.staleDays).toBe(12);
    expect(h.stale).toBe(true);
    // A session on one of its tasks resets staleness.
    const s = aSession({
      taskId: w.ids.shoes.id,
      startAt: later.toISOString(),
      endAt: later.toISOString(),
    });
    expect(
      computeProjectHealth(plan, { milestones: [], tasks: w.tasks, sessions: [s], now: later })
        .staleDays,
    ).toBe(0);

    const overdue = { ...plan, deadline: '2026-09-01' };
    const ho = computeProjectHealth(overdue, { milestones: [], tasks: w.tasks, now });
    expect(ho.overdue).toBe(true);
    expect(ho.daysToDeadline).toBe(-11);
  });
});

describe('goal and area attention', () => {
  it('sums session minutes in the window and flags neglect', () => {
    const w = aWorld();
    const now = testClock().now();
    const recent = aSession({
      taskId: w.ids.intro.id,
      startAt: '2026-09-10T09:00:00.000Z',
      endAt: '2026-09-10T10:30:00.000Z',
    });
    const old = aSession({
      taskId: w.ids.intro.id,
      startAt: '2026-08-01T09:00:00.000Z',
      endAt: '2026-08-01T12:00:00.000Z',
    });
    const input = { ...w, sessions: [recent, old], now };

    const graduate = computeGoalAttention(w.ids.graduate, input);
    expect(graduate.minutesInWindow).toBe(90);
    expect(graduate.neglected).toBe(false);
    // Study: 10h/week → 1200 min per 14 days, split across 2 active goals → 600 each.
    expect(graduate.expectedMinutes).toBe(600);
    expect(graduate.ratio).toBeCloseTo(0.15);
    expect(graduate.lastSessionAt).toBe('2026-09-10T10:30:00.000Z');

    const spanish = computeGoalAttention(w.ids.spanish, input);
    expect(spanish.minutesInWindow).toBe(0);
    expect(spanish.neglected).toBe(true);

    const study = computeAreaAttention(w.ids.study, input);
    expect(study.minutesInWindow).toBe(90);
    expect(study.targetMinutes).toBe(1200);
    expect(study.activeGoals).toBe(2);

    const health = computeAreaAttention(w.ids.health, input);
    expect(health.ratio).toBe(0);
  });

  it('has no expectation without an area target', () => {
    const w = aWorld();
    const noTarget = {
      ...w,
      areas: w.areas.map((a) => ({ ...a, weeklyHoursTarget: 0 })),
      sessions: [],
      now: testClock().now(),
    };
    const g = computeGoalAttention(w.ids.run, noTarget);
    expect(g.expectedMinutes).toBeNull();
    expect(g.ratio).toBeNull();
  });
});

describe('links', () => {
  it('creates once per pair in either direction and groups the other ends', () => {
    const clock = testClock();
    const task = aTask();
    const note = aNote();
    const first = makeLink(clock, [], { type: 'task', id: task.id }, { type: 'note', id: note.id });
    expect(first.created).toBe(true);
    const again = makeLink(
      clock,
      [first.link],
      { type: 'note', id: note.id },
      { type: 'task', id: task.id },
    );
    expect(again.created).toBe(false);
    expect(again.link.id).toBe(first.link.id);
    expect(
      findDuplicateLink([first.link], { type: 'task', id: task.id }, { type: 'note', id: note.id }),
    ).toBe(first.link);
    expect(() =>
      makeLink(clock, [], { type: 'task', id: task.id }, { type: 'task', id: task.id }),
    ).toThrow(/itself/);

    const person = aPerson();
    const other = aLink({ fromType: 'person', fromId: person.id, toType: 'task', toId: task.id });
    const groups = groupLinked([first.link, other], { type: 'task', id: task.id });
    expect(groups.note?.[0]?.id).toBe(note.id);
    expect(groups.person?.[0]?.id).toBe(person.id);
  });
});

describe('durations', () => {
  it('parses common forms and formats back', () => {
    expect(parseDuration('45')).toBe(45);
    expect(parseDuration('45m')).toBe(45);
    expect(parseDuration('1h')).toBe(60);
    expect(parseDuration('1h30')).toBe(90);
    expect(parseDuration('1h 30m')).toBe(90);
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('2.5h')).toBe(150);
    expect(parseDuration('90 min')).toBe(90);
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('')).toBeNull();
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(120)).toBe('2h');
  });
});

describe('resolveNoteParent (week 12)', () => {
  it('derives the area from the project and refuses missing or archived parents for new assignments', async () => {
    const { resolveNoteParent, HierarchyError } = await import('../../src/services/hierarchy');
    const { anArea, aProject } = await import('../builders');
    const area = anArea();
    const other = anArea();
    const project = aProject({ areaId: area.id });
    const archived = aProject({ areaId: area.id, status: 'archived' });
    const s = { areas: [area, other], goals: [], projects: [project, archived], tasks: [] };
    expect(resolveNoteParent({ projectId: project.id, areaId: other.id }, s)).toEqual({
      projectId: project.id,
      areaId: area.id,
    });
    expect(resolveNoteParent({ projectId: null, areaId: other.id }, s)).toEqual({
      projectId: null,
      areaId: other.id,
    });
    expect(() => resolveNoteParent({ projectId: archived.id, areaId: null }, s)).toThrow(
      HierarchyError,
    );
    // Already inside the archived project: still allowed to stay there.
    expect(
      resolveNoteParent({ projectId: archived.id, areaId: null }, s, {
        previousProjectId: archived.id,
      }),
    ).toEqual({ projectId: archived.id, areaId: area.id });
    expect(() =>
      resolveNoteParent({ projectId: '00000000-0000-7000-8000-000000000001', areaId: null }, s),
    ).toThrow('That project does not exist.');
    expect(() =>
      resolveNoteParent({ projectId: null, areaId: '00000000-0000-7000-8000-000000000001' }, s),
    ).toThrow('That area does not exist.');
  });
});
