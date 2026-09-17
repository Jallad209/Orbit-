import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAN_SETTINGS,
  buildCapacity,
  fixedClock,
  materializePlan,
  planDay,
  pressure,
  seedWorld,
  type PlanSnapshot,
} from '../../src';
import { aBlock, aRoutine, aTask, aWorld, anEvent, testClock } from '../builders';
import { createRecord } from '../../src/records';
import { RoutineInstanceSchema, RuleSchema, TaskSchema } from '../../src/schema';

const DATE = '2026-09-14'; // Monday; the clock is Saturday 12 Sep, so nothing is "past".
const clock = testClock();

function snapshotOf(w: ReturnType<typeof aWorld>): PlanSnapshot {
  return { areas: w.areas, goals: w.goals, projects: w.projects, tasks: w.tasks };
}

describe('planDay', () => {
  it('plans an empty day without throwing', () => {
    const p = planDay({ areas: [], goals: [], projects: [], tasks: [] }, DATE, {}, clock);
    expect(p.blocks).toEqual([]);
    expect(p.leftOut).toEqual([]);
    expect(p.commitment.acceptedTaskIds).toEqual([]);
    expect(p.stats.freeMin).toBe(540);
  });

  it('never moves or overlaps a locked block', () => {
    const w = aWorld(clock);
    const locked = aBlock(
      { date: DATE, startMin: 600, endMin: 720, taskId: w.ids.cards.id, locked: true },
      clock,
    );
    const p = planDay({ ...snapshotOf(w), blocks: [locked] }, DATE, {}, clock);
    const fixed = p.blocks.find((b) => b.kind === 'fixed');
    expect(fixed).toMatchObject({ startMin: 600, endMin: 720, existingBlockId: locked.id });
    for (const b of p.blocks) {
      if (b.kind === 'fixed') continue;
      expect(b.endMin <= 600 || b.startMin >= 720).toBe(true);
    }
    expect(p.leftOut.find((l) => l.id === w.ids.cards.id)?.reason).toBe('scheduled');
  });

  it('ranks an overdue task above a future task of the same importance', () => {
    const w = aWorld(clock);
    const overdue = aTask(
      { title: 'Overdue', status: 'open', dueAt: '2026-09-10T00:00:00.000Z', estimateMin: 30 },
      clock,
    );
    const future = aTask(
      { title: 'Future', status: 'open', dueAt: '2026-10-10T00:00:00.000Z', estimateMin: 30 },
      clock,
    );
    const p = planDay({ ...snapshotOf(w), tasks: [future, overdue] }, DATE, {}, clock);
    expect(p.blocks.map((b) => b.title)).toEqual(['Overdue', 'Future']);
    expect(p.explanations[overdue.id]!.score).toBeGreaterThan(p.explanations[future.id]!.score);
    expect(p.explanations[overdue.id]!.reasons[0]).toBe('Due 4 days ago');
    expect(p.explanations[overdue.id]!.components.overdueBoost).toBeCloseTo(1.4);
  });

  it('leaves a task with an unmet dependency out with reason blocked', () => {
    const w = aWorld(clock);
    const p = planDay(snapshotOf(w), DATE, {}, clock);
    const method = p.leftOut.find((l) => l.id === w.ids.method.id);
    expect(method?.reason).toBe('blocked');
    expect(method?.detail).toContain('Write intro');
    expect(p.explanations[w.ids.method.id]).toBeUndefined();
  });

  it('excludes high-energy tasks on a low-energy day with reason energy', () => {
    const high = aTask({ title: 'Deep work', status: 'open', energy: 'high' }, clock);
    const low = aTask({ title: 'Tidy desk', status: 'open', energy: 'low' }, clock);
    const p = planDay(
      { areas: [], goals: [], projects: [], tasks: [high, low] },
      DATE,
      { energy: 'low' },
      clock,
    );
    expect(p.leftOut.find((l) => l.id === high.id)?.reason).toBe('energy');
    expect(p.blocks.map((b) => b.taskId)).toEqual([low.id]);
  });

  it('is deterministic: the same snapshot planned twice is identical', () => {
    const world = seedWorld({ seed: 42, sizes: { tasks: 300 } });
    const a = planDay(world, DATE, { energy: 'medium' }, clock);
    const b = planDay(world, DATE, { energy: 'medium' }, clock);
    expect(a).toEqual(b);
    expect(a.blocks.length).toBeGreaterThan(3);
  });

  it('honours rest boundaries, events, and the buffer between blocks', () => {
    const w = aWorld(clock);
    const meeting = anEvent(
      {
        title: 'Standup',
        startAt: new Date(2026, 8, 14, 10, 0).toISOString(),
        endAt: new Date(2026, 8, 14, 10, 30).toISOString(),
      },
      clock,
    );
    const p = planDay(
      { ...snapshotOf(w), events: [meeting] },
      DATE,
      { restBoundaries: [{ startMin: 750, endMin: 810 }] },
      clock,
    );
    expect(p.capacity.busy.map((b) => b.kind)).toEqual(['event', 'rest']);
    expect(p.blocks.find((b) => b.kind === 'event')?.title).toBe('Standup');
    const proposed = p.blocks.filter((b) => b.kind === 'task');
    for (let i = 1; i < proposed.length; i++) {
      expect(proposed[i]!.startMin - proposed[i - 1]!.endMin).toBeGreaterThanOrEqual(0);
    }
    for (const b of proposed) {
      expect(b.endMin <= 600 || b.startMin >= 630).toBe(true);
      expect(b.endMin <= 750 || b.startMin >= 810).toBe(true);
    }
  });

  it('splits a long task across two free stretches, never below the minimum part', () => {
    const w = aWorld(clock);
    const long = aTask({ title: 'Long', status: 'open', estimateMin: 150, priority: 1 }, clock);
    // Working window 09:00–11:00 and 13:00–15:00 via a rest boundary: no single stretch fits 150.
    const p = planDay(
      { ...snapshotOf(w), tasks: [long] },
      DATE,
      {
        workingWindow: { startMin: 540, endMin: 900 },
        restBoundaries: [{ startMin: 660, endMin: 780 }],
      },
      clock,
    );
    const parts = p.blocks.filter((b) => b.taskId === long.id);
    expect(parts).toHaveLength(2);
    expect(parts.map((b) => b.part)).toEqual([
      { index: 0, of: 2 },
      { index: 1, of: 2 },
    ]);
    expect(parts.reduce((m, b) => m + (b.endMin - b.startMin), 0)).toBe(150);
    expect(p.explanations[long.id]!.placedAt).toHaveLength(2);
  });

  it('leaves out what does not fit, saying how much was free', () => {
    const big = aTask({ title: 'Big', status: 'open', estimateMin: 60 }, clock);
    const small = aTask({ title: 'Small', status: 'open', estimateMin: 30, priority: 1 }, clock);
    const p = planDay(
      { areas: [], goals: [], projects: [], tasks: [big, small] },
      DATE,
      { workingWindow: { startMin: 540, endMin: 600 } },
      clock,
    );
    expect(p.blocks.map((b) => b.title)).toEqual(['Small']);
    const left = p.leftOut.find((l) => l.id === big.id);
    expect(left?.reason).toBe('capacity');
    expect(left?.detail).toMatch(/Needs 1h, only 20m free/);
  });

  it('applies user removals, the score bar, and constraint rules', () => {
    const w = aWorld(clock);
    const rule = createRecord(RuleSchema, clock, {
      type: 'constraint',
      config: { kind: 'noHighEnergyAfter', afterMin: 600 },
    });
    const deep = aTask({ title: 'Deep', status: 'open', energy: 'high', estimateMin: 120 }, clock);
    const p = planDay(
      { ...snapshotOf(w), tasks: [...w.tasks, deep], rules: [rule] },
      DATE,
      { excludeTaskIds: [w.ids.intro.id], minScore: 0.5 },
      clock,
    );
    expect(p.leftOut.find((l) => l.id === w.ids.intro.id)?.reason).toBe('user');
    // High-energy work can only land before 10:00; 120 min does not fit there.
    expect(p.leftOut.find((l) => l.id === deep.id)?.reason).toBe('capacity');
    expect(p.capacity.free.some((i) => !i.highEnergyAllowed)).toBe(true);

    const reserve = createRecord(RuleSchema, clock, {
      type: 'constraint',
      config: {
        kind: 'reserve',
        dayOfWeek: 'MO',
        startMin: 540,
        endMin: 720,
        areaId: w.ids.health.id,
        label: 'Health mornings',
      },
    });
    const q = planDay({ ...snapshotOf(w), rules: [reserve] }, DATE, {}, clock);
    for (const b of q.blocks.filter((b) => b.startMin < 720)) {
      const task = w.tasks.find((t) => t.id === b.taskId);
      expect(task?.areaId).toBe(w.ids.health.id);
    }
    const blocked = createRecord(RuleSchema, clock, {
      type: 'constraint',
      config: { kind: 'reserve', dayOfWeek: 'MO', startMin: 540, endMin: 660, areaId: null },
    });
    const cap = buildCapacity(
      { ...snapshotOf(w), rules: [blocked] },
      DATE,
      DEFAULT_PLAN_SETTINGS,
      clock.now(),
    );
    expect(cap.busy[0]).toMatchObject({ kind: 'reserve', startMin: 540, endMin: 660 });
    expect(cap.freeMin).toBe(420);
  });

  it('plans today from now on, never into the past', () => {
    const w = aWorld(clock);
    const midday = fixedClock(new Date(2026, 8, 14, 11, 7));
    const p = planDay(snapshotOf(w), DATE, {}, midday);
    expect(p.capacity.busy[0]).toMatchObject({ kind: 'past', endMin: 675 });
    for (const b of p.blocks) expect(b.startMin).toBeGreaterThanOrEqual(675);
  });

  it('places routine instances in their preferred window first', () => {
    const w = aWorld(clock);
    const run = aRoutine(
      { title: 'Run', durationMin: 45, preferredWindow: { startMin: 600, endMin: 720 } },
      clock,
    );
    const inst = createRecord(RoutineInstanceSchema, clock, { routineId: run.id, date: DATE });
    const p = planDay(
      { ...snapshotOf(w), routines: [run], routineInstances: [inst] },
      DATE,
      {},
      clock,
    );
    const block = p.blocks.find((b) => b.routineInstanceId === inst.id);
    expect(block).toMatchObject({ kind: 'routine', startMin: 600, endMin: 645 });
    expect(p.explanations[inst.id]!.reasons[0]).toBe('Routine due today');
    expect(p.commitment.acceptedTaskIds).not.toContain(inst.id);
  });

  it('places a task at its optional preferred start on the selected day', () => {
    const task = createRecord(TaskSchema, clock, {
      title: 'Quiet planning',
      status: 'open',
      estimateMin: 45,
      preferredDate: DATE,
      preferredStartMin: 14 * 60,
    });
    const p = planDay({ areas: [], goals: [], projects: [], tasks: [task] }, DATE, {}, clock);
    expect(p.blocks.find((block) => block.taskId === task.id)).toMatchObject({
      startMin: 14 * 60,
      endMin: 14 * 60 + 45,
    });
    const tomorrow = planDay(
      { areas: [], goals: [], projects: [], tasks: [task] },
      '2026-09-15',
      {},
      clock,
    );
    expect(tomorrow.blocks.some((block) => block.taskId === task.id)).toBe(false);
  });

  it('explains next actions, goals, priority, staleness, and energy in plain words', () => {
    const w = aWorld(clock);
    const later = fixedClock(new Date(2026, 8, 20, 9, 0));
    const p = planDay(snapshotOf(w), '2026-09-21', { energy: 'high' }, later);
    const why = p.explanations[w.ids.intro.id]!;
    expect(why.reasons).toEqual([
      'Project deadline 2026-12-01',
      'Goal “Graduate” is importance 5/5',
      'Next action for “Thesis”',
      'Untouched for 8 days',
      'Easy fit for a high-energy day',
    ]);
    expect(why.components.nextAction).toBe(1.25);
    expect(pressure(0)).toBe(3);
    expect(pressure(null)).toBe(1);
    expect(pressure(1)).toBe(2);
  });

  it('materializes a proposal into a commitment and planner blocks, reusing an existing commitment', () => {
    const w = aWorld(clock);
    const p = planDay(snapshotOf(w), DATE, {}, clock);
    const m = materializePlan(p, clock);
    expect(m.commitment.acceptedTaskIds).toEqual(p.commitment.acceptedTaskIds);
    expect(m.blocks).toHaveLength(p.blocks.filter((b) => b.kind === 'task').length);
    expect(m.blocks.every((b) => b.source === 'planner' && !b.locked && b.date === DATE)).toBe(
      true,
    );
    const again = materializePlan(p, clock, m.commitment);
    expect(again.commitment.id).toBe(m.commitment.id);
    expect(again.commitment.createdAt).toBe(m.commitment.createdAt);
  });

  it('matches the golden proposal for the fixture world', () => {
    const dir = new URL('./fixtures/', import.meta.url);
    if (process.env.UPDATE_PLANNER_GOLDEN) {
      const w = seedWorld({
        seed: 3,
        sizes: { tasks: 40, projects: 4, goals: 4, areas: 2, events: 6 },
      });
      const fixture: PlanSnapshot = {
        areas: w.areas,
        goals: w.goals,
        projects: w.projects,
        tasks: w.tasks,
        events: w.events,
        routines: w.routines,
        routineInstances: w.routineInstances,
        blocks: w.blocks,
        sessions: w.sessions,
        rules: w.rules,
      };
      writeFileSync(new URL('world.json', dir), JSON.stringify(fixture, null, 2) + '\n');
    }
    const snapshot = JSON.parse(readFileSync(new URL('world.json', dir), 'utf8')) as PlanSnapshot;
    const proposal = planDay(snapshot, DATE, { energy: 'medium' }, clock);
    const file = new URL('world.expected.json', dir);
    if (process.env.UPDATE_PLANNER_GOLDEN) {
      writeFileSync(file, JSON.stringify(proposal, null, 2) + '\n');
    }
    const expected = JSON.parse(readFileSync(file, 'utf8'));
    expect(proposal).toEqual(expected);
  });

  it('plans 2,000 open tasks well under the budget', () => {
    const world = seedWorld({ seed: 7, sizes: { tasks: 3700 } });
    const open = world.tasks.filter((t) => t.status === 'open').length;
    expect(open).toBeGreaterThanOrEqual(2000);
    planDay(world, DATE, {}, clock); // warm up
    const t0 = performance.now();
    planDay(world, DATE, {}, clock);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(250); // the bench script guards the real 50 ms budget
  });
});
