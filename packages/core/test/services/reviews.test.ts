import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/clock';
import { addDays, toLocalDate } from '../../src/dates';
import { newId } from '../../src/ids';
import { createRecord } from '../../src/records';
import { BlockSchema, DayCommitmentSchema, RuleSchema, SessionSchema } from '../../src/schema';
import type { Rule, Session } from '../../src/schema';
import {
  activeSession,
  areaOfTask,
  billsDueWithin,
  buildEvening,
  buildMorning,
  completeTask,
  computeAtRisk,
  estimateAccuracy,
  hasSession,
  manualSession,
  needsActual,
  sessionDayParts,
  sessionMinutes,
  startSession,
  stopSession,
  taskSessionMinutes,
  timeByArea,
  trailingRange,
} from '../../src/services';
import {
  DEFAULT_ROLLOVER,
  applyRollover,
  nextMonday,
  rolloverDate,
  rolloverPolicy,
  suggestRollover,
} from '../../src/rules';
import { aBill, aProject, aTask, aWorld, anArea, testClock } from '../builders';

// Wednesday 16 Sep 2026, 18:00 local: the day is over, next Monday is the 21st.
const EVENING = new Date(2026, 8, 16, 18, 0, 0);
const TODAY = '2026-09-16';

const local = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();

function rolloverRule(config: Rule['config']): Rule {
  return createRecord(RuleSchema, testClock(), { type: 'rollover', name: 'Rollover', config });
}

describe('sessions', () => {
  it('starts a session, closing whatever was running', () => {
    const clock = testClock('2026-09-16T09:00:00.000Z');
    const a = aTask();
    const b = aTask();
    const first = startSession(a.id, [], clock);
    expect(first.closed).toEqual([]);
    expect(first.session).toMatchObject({ taskId: a.id, endAt: null });
    expect(first.session.startAt).toBe('2026-09-16T09:00:00.000Z');

    clock.advance(25 * 60_000);
    const second = startSession(b.id, [first.session], clock);
    expect(second.closed).toHaveLength(1);
    expect(second.closed[0]).toMatchObject({
      id: first.session.id,
      endAt: '2026-09-16T09:25:00.000Z',
    });
    expect(second.session.taskId).toBe(b.id);
  });

  it('stops a running session and leaves a finished one alone', () => {
    const clock = testClock('2026-09-16T09:00:00.000Z');
    const { session } = startSession(aTask().id, [], clock);
    clock.advance(40 * 60_000);
    const stopped = stopSession(session, clock);
    expect(stopped.endAt).toBe('2026-09-16T09:40:00.000Z');
    expect(stopSession(stopped, clock)).toBe(stopped);
    // A clock that went backwards never produces a negative session.
    clock.set('2026-09-16T08:00:00.000Z');
    expect(stopSession(session, clock).endAt).toBe(session.startAt);
  });

  it('the active session survives a simulated restart and keeps counting from its wall-clock start', () => {
    const clock = testClock('2026-09-16T09:00:00.000Z');
    const task = aTask();
    const { session } = startSession(task.id, [], clock);
    // What the repository holds: JSON on disk, parsed back after the app restarts.
    const persisted: Session[] = JSON.parse(JSON.stringify([session, aSessionDone()])).map(
      (s: unknown) => SessionSchema.parse(s),
    );
    clock.advance(90 * 60_000); // the restart took a while
    const active = activeSession(persisted);
    expect(active).not.toBeNull();
    expect(active!.id).toBe(session.id);
    expect(sessionMinutes(active!, clock.now())).toBe(90);
    expect(activeSession([aSessionDone()])).toBeNull();
  });

  it('picks the newest start when more than one session is somehow running', () => {
    const older = createRecord(SessionSchema, testClock(), {
      taskId: aTask().id,
      startAt: '2026-09-16T08:00:00.000Z',
      endAt: null,
    });
    const newer = createRecord(SessionSchema, testClock(), {
      taskId: aTask().id,
      startAt: '2026-09-16T09:00:00.000Z',
      endAt: null,
    });
    expect(
      activeSession([older, newer, { ...newer, deletedAt: '2026-09-16T10:00:00.000Z' }])?.id,
    ).toBe(newer.id);
  });

  it('records a manual session and sums minutes per task', () => {
    const clock = testClock('2026-09-16T18:00:00.000Z');
    const task = aTask();
    const manual = manualSession(
      task.id,
      '2026-09-16T14:00:00.000Z',
      '2026-09-16T15:30:00.000Z',
      clock,
    );
    expect(manual).toMatchObject({ taskId: task.id, endAt: '2026-09-16T15:30:00.000Z' });
    expect(sessionMinutes(manual, clock.now())).toBe(90);
    const running = startSession(task.id, [], clock).session;
    clock.advance(10 * 60_000);
    expect(taskSessionMinutes(task.id, [manual, running, aSessionDone()], clock.now())).toBe(100);
    expect(hasSession(task.id, [manual])).toBe(true);
    expect(hasSession(task.id, [aSessionDone()])).toBe(false);
    expect(hasSession(task.id, [{ ...manual, deletedAt: manual.createdAt }])).toBe(false);
  });
});

describe('time by area', () => {
  it('splits a session at local midnight so each part counts toward its own day', () => {
    const s = createRecord(SessionSchema, testClock(), {
      taskId: aTask().id,
      startAt: local(2026, 9, 14, 23, 30),
      endAt: local(2026, 9, 15, 0, 30),
    });
    expect(sessionDayParts(s, EVENING)).toEqual([
      { date: '2026-09-14', minutes: 30 },
      { date: '2026-09-15', minutes: 30 },
    ]);
    // A running session counts to now, and a session spanning two midnights has three parts.
    const running = createRecord(SessionSchema, testClock(), {
      taskId: aTask().id,
      startAt: local(2026, 9, 14, 23, 0),
      endAt: null,
    });
    expect(sessionDayParts(running, new Date(2026, 8, 16, 1, 0))).toEqual([
      { date: '2026-09-14', minutes: 60 },
      { date: '2026-09-15', minutes: 1440 },
      { date: '2026-09-16', minutes: 60 },
    ]);
    expect(sessionDayParts({ ...s, endAt: s.startAt }, EVENING)).toEqual([]);
  });

  it('sums sessions per area across midnight, resolving the area through the project', () => {
    const health = anArea({ name: 'Health' });
    const study = anArea({ name: 'Study' });
    const thesis = aProject({ areaId: study.id });
    const run = aTask({ areaId: health.id });
    const intro = aTask({ projectId: thesis.id, areaId: null });
    const orphan = aTask({ areaId: null, projectId: null });
    const projectById = new Map([[thesis.id, thesis]]);
    expect(areaOfTask(run, projectById)).toBe(health.id);
    expect(areaOfTask(intro, projectById)).toBe(study.id);
    expect(areaOfTask(orphan, projectById)).toBeNull();

    const sessions = [
      createRecord(SessionSchema, testClock(), {
        taskId: run.id,
        startAt: local(2026, 9, 14, 23, 30),
        endAt: local(2026, 9, 15, 0, 30),
      }),
      createRecord(SessionSchema, testClock(), {
        taskId: intro.id,
        startAt: local(2026, 9, 15, 9, 0),
        endAt: local(2026, 9, 15, 10, 0),
      }),
      createRecord(SessionSchema, testClock(), {
        taskId: orphan.id,
        startAt: local(2026, 9, 15, 11, 0),
        endAt: local(2026, 9, 15, 11, 15),
      }),
    ];
    const input = { sessions, tasks: [run, intro, orphan], projects: [thesis], now: EVENING };
    expect(timeByArea(input, { from: '2026-09-14', to: '2026-09-14' })).toEqual([
      { areaId: health.id, minutes: 30 },
    ]);
    expect(timeByArea(input, { from: '2026-09-15', to: '2026-09-15' })).toEqual([
      { areaId: study.id, minutes: 60 },
      { areaId: health.id, minutes: 30 },
      { areaId: null, minutes: 15 },
    ]);
    const week = timeByArea(input, trailingRange('2026-09-15', 7));
    expect(new Map(week.map((r) => [r.areaId, r.minutes]))).toEqual(
      new Map([
        [study.id, 60],
        [health.id, 60],
        [null, 15],
      ]),
    );
    expect(week.at(-1)!.areaId).toBeNull();
    expect(trailingRange('2026-09-15', 7)).toEqual({ from: '2026-09-09', to: '2026-09-15' });
    expect(timeByArea(input, { from: '2026-09-01', to: '2026-09-13' })).toEqual([]);
  });
});

describe('completion', () => {
  it('fills the actual from sessions when none is given, and leaves it null without sessions', () => {
    const clock = testClock('2026-09-16T10:00:00.000Z');
    const task = aTask({ estimateMin: 30 });
    const s = manualSession(task.id, '2026-09-16T09:00:00.000Z', '2026-09-16T09:45:30.000Z', clock);
    const done = completeTask(task, null, [s], clock);
    expect(done).toMatchObject({
      status: 'done',
      actualMin: 46,
      completedAt: '2026-09-16T10:00:00.000Z',
    });
    expect(completeTask(task, 20, [s], clock).actualMin).toBe(20);
    expect(completeTask(task, null, [], clock).actualMin).toBeNull();
    expect(completeTask(task, 12.4, [], clock).actualMin).toBe(12);
  });

  it('lists done tasks that still need an actual', () => {
    const clock = testClock('2026-09-16T10:00:00.000Z');
    const a = completeTask(aTask(), null, [], clock);
    const b = completeTask(aTask(), 30, [], clock);
    const c = aTask();
    const s = manualSession(c.id, '2026-09-16T09:00:00.000Z', '2026-09-16T09:30:00.000Z', clock);
    const cDone = completeTask(c, null, [s], clock);
    const open = aTask();
    expect(needsActual([a, b, cDone, open], [s]).map((t) => t.id)).toEqual([a.id]);
    // Even with the actual missing, a task with a session is not asked about.
    expect(needsActual([{ ...cDone, actualMin: null }], [s])).toEqual([]);
  });

  it('completing with an actual updates the estimate-accuracy ratio for the area', () => {
    const clock = testClock('2026-09-16T10:00:00.000Z');
    const study = anArea();
    const thesis = aProject({ areaId: study.id });
    const before = completeTask(aTask({ areaId: study.id, estimateMin: 60 }), 60, [], clock);
    const input = { tasks: [before], projects: [thesis] };
    expect(estimateAccuracy(input, 7, clock)).toEqual([
      { areaId: study.id, tasks: 1, estimateMin: 60, actualMin: 60, ratio: 1 },
    ]);

    const late = completeTask(
      aTask({ projectId: thesis.id, areaId: null, estimateMin: 30 }),
      90,
      [],
      clock,
    );
    const after = estimateAccuracy({ tasks: [before, late], projects: [thesis] }, 7, clock);
    expect(after).toEqual([
      { areaId: study.id, tasks: 2, estimateMin: 90, actualMin: 150, ratio: 150 / 90 },
    ]);

    // Sessions stand in for a missing actual; tasks outside the window, open, or without
    // an estimate are ignored; tasks without an area land in the null row.
    const withSession = aTask({ areaId: null, projectId: null, estimateMin: 20 });
    const s = manualSession(
      withSession.id,
      '2026-09-16T08:00:00.000Z',
      '2026-09-16T08:40:00.000Z',
      clock,
    );
    const old = {
      ...completeTask(aTask({ areaId: study.id, estimateMin: 10 }), 100, [], clock),
      completedAt: '2026-08-01T10:00:00.000Z',
    };
    const noEstimate = completeTask(aTask({ areaId: study.id, estimateMin: 0 }), 10, [], clock);
    const noActual = completeTask(aTask({ areaId: study.id }), null, [], clock);
    const rows = estimateAccuracy(
      {
        tasks: [
          before,
          completeTask(withSession, null, [s], clock),
          old,
          noEstimate,
          noActual,
          aTask(),
        ],
        sessions: [s],
      },
      7,
      clock,
    );
    expect(rows).toEqual([
      { areaId: study.id, tasks: 1, estimateMin: 60, actualMin: 60, ratio: 1 },
      { areaId: null, tasks: 1, estimateMin: 20, actualMin: 40, ratio: 2 },
    ]);
  });
});

describe('rollover', () => {
  it('reads the rollover rule family, falling back to the default policy', () => {
    expect(rolloverPolicy([])).toEqual(DEFAULT_ROLLOVER);
    const custom = rolloverRule({ p1: 'tomorrow', p2: 'nextWeek', p3: 'inbox' });
    expect(rolloverPolicy([custom])).toEqual({ p1: 'tomorrow', p2: 'nextWeek', p3: 'inbox' });
    expect(rolloverPolicy([{ ...custom, enabled: false }])).toEqual(DEFAULT_ROLLOVER);
    expect(rolloverPolicy([{ ...custom, deletedAt: custom.createdAt }])).toEqual(DEFAULT_ROLLOVER);
    expect(suggestRollover(aTask({ priority: 1 }))).toBe('tomorrow');
    expect(suggestRollover(aTask({ priority: 2 }), [custom])).toBe('nextWeek');
    expect(suggestRollover(aTask({ priority: 3 }), [custom])).toBe('inbox');
  });

  it('next Monday is always the week after, even from a Monday or a Sunday', () => {
    expect(nextMonday('2026-09-16')).toBe('2026-09-21'); // Wednesday
    expect(nextMonday('2026-09-14')).toBe('2026-09-21'); // Monday
    expect(nextMonday('2026-09-20')).toBe('2026-09-21'); // Sunday
    expect(rolloverDate('tomorrow', TODAY)).toBe('2026-09-17');
    expect(rolloverDate('nextWeek', TODAY)).toBe('2026-09-21');
    expect(rolloverDate('inbox', TODAY)).toBeNull();
  });

  it('moves P1 to tomorrow and P3 to next Monday by the default rule, keeping a due time', () => {
    const clock = fixedClock(EVENING);
    const p1 = aTask({ priority: 1, dueAt: local(2026, 9, 16, 17, 0) });
    const p3 = aTask({ priority: 3 });
    const choices = [p1, p3].map((t) => ({ taskId: t.id, target: suggestRollover(t) }));
    const changed = applyRollover(choices, [p1, p3], clock);
    expect(changed).toHaveLength(2);
    const [np1, np3] = changed;
    expect(toLocalDate(new Date(np1!.dueAt!))).toBe('2026-09-17');
    expect(new Date(np1!.dueAt!).getHours()).toBe(17);
    expect(toLocalDate(new Date(np3!.dueAt!))).toBe('2026-09-21');
    expect(new Date(np3!.dueAt!).getHours()).toBe(23);
    expect(new Date(np3!.dueAt!).getMinutes()).toBe(59);
    expect(np3!.status).toBe('open');
  });

  it('inbox clears the due date and status; unknown or deleted tasks are skipped', () => {
    const clock = fixedClock(EVENING);
    const t = aTask({ priority: 2, dueAt: local(2026, 9, 16, 12, 0) });
    const gone = { ...aTask(), deletedAt: '2026-09-16T00:00:00.000Z' };
    const out = applyRollover(
      [
        { taskId: t.id, target: 'inbox' },
        { taskId: gone.id, target: 'tomorrow' },
        { taskId: 'missing', target: 'tomorrow' },
      ],
      [t, gone],
      clock,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: t.id, status: 'inbox', dueAt: null });
    // An inbox task rolled forward becomes actionable again.
    const back = applyRollover([{ taskId: t.id, target: 'tomorrow' }], [out[0]!], clock);
    expect(back[0]!.status).toBe('open');
    expect(toLocalDate(new Date(back[0]!.dueAt!))).toBe(addDays(TODAY, 1));
  });
});

describe('at risk and morning', () => {
  it('flags overdue, due-soon without a block, and near-deadline projects under half done', () => {
    const w = aWorld();
    const now = new Date(2026, 8, 14, 8, 0); // Monday 14 Sep
    const overdue = aTask({ areaId: w.ids.study.id, dueAt: local(2026, 9, 12, 23, 59) });
    const older = aTask({ areaId: w.ids.study.id, dueAt: local(2026, 9, 1, 23, 59) });
    const soon = aTask({ areaId: w.ids.study.id, dueAt: local(2026, 9, 16, 23, 59) });
    const sooner = aTask({ areaId: w.ids.study.id, dueAt: local(2026, 9, 14, 23, 59) });
    const soonPlanned = aTask({ areaId: w.ids.study.id, dueAt: local(2026, 9, 15, 23, 59) });
    const far = aTask({ areaId: w.ids.study.id, dueAt: local(2026, 9, 30, 23, 59) });
    const doneOverdue = aTask({ status: 'done', dueAt: local(2026, 9, 1, 23, 59) });
    const near = aProject({ areaId: w.ids.study.id, deadline: '2026-09-20' });
    const nearer = aProject({ areaId: w.ids.study.id, deadline: '2026-09-15' });
    const nearButAhead = aProject({ areaId: w.ids.study.id, deadline: '2026-09-20' });
    const aheadDone = aTask({ projectId: nearButAhead.id, status: 'done' });
    const aheadOpen = aTask({ projectId: nearButAhead.id });
    const nearTask = aTask({ projectId: near.id });
    const r = computeAtRisk(
      {
        tasks: [
          ...w.tasks,
          overdue,
          older,
          soon,
          sooner,
          soonPlanned,
          far,
          doneOverdue,
          aheadDone,
          aheadOpen,
          nearTask,
        ],
        projects: [...w.projects, near, nearer, nearButAhead],
        milestones: w.milestones,
        plannedTaskIds: new Set([soonPlanned.id]),
        now,
      },
      '2026-09-14',
    );
    expect(r.overdue.map((t) => t.id)).toEqual([older.id, overdue.id]);
    expect(r.dueSoon.map((t) => t.id)).toEqual([sooner.id, soon.id]);
    // Thesis (Dec deadline) is not near; the 50%-done project is near but not at risk.
    expect(r.projects.map((p) => p.project.id)).toEqual([nearer.id, near.id]);
    expect(r.projects[1]!.health.daysToDeadline).toBe(6);
    // Loosen the thresholds and the half-done project joins.
    expect(
      computeAtRisk(
        { tasks: [aheadDone, aheadOpen], projects: [nearButAhead], now },
        '2026-09-14',
        { progressBelow: 0.6, dueSoonDays: 1 },
      ).projects.map((p) => p.project.id),
    ).toEqual([nearButAhead.id]);
  });

  it('lists unpaid bills due within three days, overdue ones first', () => {
    const paid = aBill({ dueAt: '2026-09-17', paid: true });
    const soon = aBill({ dueAt: '2026-09-19' });
    const overdue = aBill({ dueAt: '2026-09-10' });
    const later = aBill({ dueAt: '2026-09-20' });
    expect(billsDueWithin([paid, soon, overdue, later], TODAY, 3).map((b) => b.id)).toEqual([
      overdue.id,
      soon.id,
    ]);
    expect(billsDueWithin([later], TODAY, 4).map((b) => b.id)).toEqual([later.id]);
  });

  it('builds the briefing: energy default, proposal, at-risk, and bills', () => {
    const clock = fixedClock(new Date(2026, 8, 14, 8, 0));
    const w = aWorld(clock);
    const overdue = aTask(
      { areaId: w.ids.study.id, dueAt: local(2026, 9, 12, 23, 59), priority: 1 },
      clock,
    );
    const bill = aBill({ dueAt: '2026-09-15' }, clock);
    const m = buildMorning(
      { ...w, tasks: [...w.tasks, overdue], bills: [bill] },
      '2026-09-14',
      { energy: 'high' },
      clock,
    );
    expect(m.date).toBe('2026-09-14');
    expect(m.energy).toBe('high');
    expect(m.proposal.energy).toBe('high');
    expect(m.proposal.blocks.length).toBeGreaterThan(0);
    expect(m.atRisk.overdue.map((t) => t.id)).toEqual([overdue.id]);
    expect(m.billsDue.map((b) => b.id)).toEqual([bill.id]);
    // Settings default to medium energy; a stored block on the day counts as planned.
    const soon = aTask({ areaId: w.ids.study.id, dueAt: local(2026, 9, 15, 23, 59) }, clock);
    const stored = {
      ...w,
      tasks: [...w.tasks, soon],
      blocks: [
        createRecord(BlockSchema, clock, {
          date: '2026-09-14',
          startMin: 540,
          endMin: 600,
          taskId: soon.id,
          locked: true,
        }),
      ],
    };
    const m2 = buildMorning(stored, '2026-09-14', {}, clock);
    expect(m2.energy).toBe('medium');
    expect(m2.atRisk.dueSoon).toEqual([]);
    expect(m2.billsDue).toEqual([]);
  });
});

describe('evening', () => {
  it('lists exactly the unfinished committed tasks, and nothing else', () => {
    const clock = fixedClock(EVENING);
    const a = aTask({ title: 'A' }, clock);
    const b = aTask({ title: 'B' }, clock);
    const c = completeTask(aTask({ title: 'C' }, clock), 30, [], clock);
    const archived = aTask({ title: 'Archived', status: 'archived' }, clock);
    const notCommitted = aTask({ title: 'Not committed' }, clock);
    const deleted = { ...aTask({ title: 'Deleted' }, clock), deletedAt: clock.now().toISOString() };
    const commitment = createRecord(DayCommitmentSchema, clock, {
      date: TODAY,
      acceptedTaskIds: [a.id, b.id, c.id, archived.id, deleted.id, newId()],
      energy: 'medium',
      acceptedAt: clock.now().toISOString(),
    });
    const r = buildEvening(
      {
        tasks: [a, b, c, archived, notCommitted, deleted],
        sessions: [],
        dayCommitments: [commitment],
      },
      TODAY,
      clock,
    );
    expect(r.commitment?.id).toBe(commitment.id);
    expect(r.committed.map((t) => t.title)).toEqual(['A', 'B', 'C', 'Archived']);
    expect(r.done.map((t) => t.title)).toEqual(['C']);
    expect(r.unfinished.map((t) => t.title)).toEqual(['A', 'B']);
    expect(r.rollover.map((x) => [x.task.title, x.suggestion])).toEqual([
      ['A', 'tomorrow'],
      ['B', 'tomorrow'],
    ]);
  });

  it('asks for actuals, sums the day by area, and suggests by the rollover rule', () => {
    const clock = fixedClock(EVENING);
    const study = anArea({}, clock);
    const withTimer = aTask({ areaId: study.id }, clock);
    const s = manualSession(
      withTimer.id,
      local(2026, 9, 16, 9, 0),
      local(2026, 9, 16, 10, 30),
      clock,
    );
    const timed = completeTask(withTimer, null, [s], clock);
    const untimed = completeTask(aTask({ areaId: study.id }, clock), null, [], clock);
    const yesterday = {
      ...completeTask(aTask({}, clock), null, [], clock),
      completedAt: local(2026, 9, 15, 20, 0),
    };
    const p3 = aTask({ priority: 3 }, clock);
    const commitment = createRecord(DayCommitmentSchema, clock, {
      date: TODAY,
      acceptedTaskIds: [timed.id, p3.id],
      energy: 'low',
      acceptedAt: clock.now().toISOString(),
    });
    const r = buildEvening(
      {
        tasks: [timed, untimed, yesterday, p3],
        sessions: [s],
        dayCommitments: [commitment],
        rules: [rolloverRule({ p1: 'tomorrow', p2: 'tomorrow', p3: 'inbox' })],
      },
      TODAY,
      clock,
    );
    expect(r.needsActual.map((t) => t.id)).toEqual([untimed.id]);
    expect(r.timeByArea).toEqual([{ areaId: study.id, minutes: 90 }]);
    expect(r.rollover).toEqual([{ task: p3, suggestion: 'inbox' }]);
    // No commitment for the day: nothing committed, nothing to roll over.
    const empty = buildEvening({ tasks: [p3], sessions: [], dayCommitments: [] }, TODAY, clock);
    expect(empty.commitment).toBeNull();
    expect(empty.committed).toEqual([]);
    expect(empty.rollover).toEqual([]);
  });
});

function aSessionDone(): Session {
  return createRecord(SessionSchema, testClock(), {
    taskId: aTask().id,
    startAt: '2026-09-11T09:00:00.000Z',
    endAt: '2026-09-11T09:30:00.000Z',
  });
}
