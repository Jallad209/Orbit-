import { describe, expect, it } from 'vitest';
import {
  BlockError,
  lockBlock,
  moveBlock,
  obstaclesFor,
  placeTask,
  recalculateDay,
  resizeBlock,
  snapToGrid,
  splitBlock,
  summarizeRecalc,
  unlockBlock,
  fixedClock,
} from '../../src';
import type { PlanSnapshot } from '../../src';
import { aBlock, aTask, aWorld, anEvent, testClock } from '../builders';

const clock = testClock();
const DATE = '2026-09-14';

describe('block operations', () => {
  it('snaps to the 15-minute grid', () => {
    expect(snapToGrid(547)).toBe(540);
    expect(snapToGrid(553)).toBe(555);
    expect(snapToGrid(600)).toBe(600);
  });

  it('rejects a move that would overlap a locked block, with a reason', () => {
    const w = aWorld(clock);
    const locked = aBlock(
      { date: DATE, startMin: 600, endMin: 660, taskId: w.ids.cards.id, locked: true },
      clock,
    );
    const mine = aBlock({ date: DATE, startMin: 540, endMin: 570, taskId: w.ids.intro.id }, clock);
    const titles = new Map(w.tasks.map((t) => [t.id, t.title]));
    const obstacles = obstaclesFor(DATE, [locked, mine], [], titles, mine.id);
    expect(() => moveBlock(mine, 585, obstacles)).toThrow(BlockError);
    try {
      moveBlock(mine, 585, obstacles);
    } catch (e) {
      expect((e as BlockError).code).toBe('overlap');
      expect((e as BlockError).message).toBe(
        'That would overlap “Make flash cards” (10:00–11:00).'.replace(/[“”]/g, ''),
      );
    }
    const moved = moveBlock(mine, 667, obstacles);
    expect(moved).toMatchObject({ startMin: 660, endMin: 690, source: 'manual' });
    expect(() => moveBlock(lockBlock(mine), 700, obstacles)).toThrow(/Unlock/);
    expect(unlockBlock(lockBlock(mine)).locked).toBe(false);
  });

  it('events are obstacles too, and unlocked planner blocks are not', () => {
    const w = aWorld(clock);
    const standup = anEvent(
      {
        title: 'Standup',
        startAt: new Date(2026, 8, 14, 10, 0).toISOString(),
        endAt: new Date(2026, 8, 14, 10, 30).toISOString(),
      },
      clock,
    );
    const other = aBlock({ date: DATE, startMin: 660, endMin: 720, taskId: w.ids.lit.id }, clock);
    const mine = aBlock({ date: DATE, startMin: 540, endMin: 570, taskId: w.ids.intro.id }, clock);
    const obstacles = obstaclesFor(DATE, [other, mine], [standup], new Map(), mine.id);
    expect(obstacles).toHaveLength(1);
    expect(() => moveBlock(mine, 590, obstacles)).toThrow(/Standup/);
    expect(moveBlock(mine, 660, obstacles).startMin).toBe(660);
  });

  it('resizing below 15 minutes or outside the day is prevented', () => {
    const b = aBlock({ date: DATE, startMin: 540, endMin: 600 }, clock);
    expect(() => resizeBlock(b, 'end', 545, [])).toThrow(/at least 15/);
    expect(resizeBlock(b, 'end', 552, []).endMin).toBe(555);
    expect(resizeBlock(b, 'start', 570, []).startMin).toBe(570);
    expect(() => resizeBlock({ ...b, startMin: 1400, endMin: 1440 }, 'end', 1500, [])).toThrow(
      /inside the day/,
    );
  });

  it('splits into two blocks that both keep the reference', () => {
    const t = aTask({ status: 'open' }, clock);
    const b = aBlock({ date: DATE, startMin: 540, endMin: 660, taskId: t.id, locked: true }, clock);
    const [a, c] = splitBlock(b, 600, clock);
    expect(a).toMatchObject({ startMin: 540, endMin: 600, taskId: t.id, locked: true });
    expect(c).toMatchObject({ startMin: 600, endMin: 660, taskId: t.id, locked: true });
    expect(c.id).not.toBe(a.id);
    expect(() => splitBlock(b, 546, clock)).toThrow(/halves/);
  });

  it('places a dropped task at the snapped minute with its estimate', () => {
    const t = aTask({ status: 'open', estimateMin: 50 }, clock);
    const b = placeTask(t.id, DATE, 608, t.estimateMin, [], clock);
    expect(b).toMatchObject({ startMin: 615, endMin: 675, source: 'manual', taskId: t.id });
    expect(placeTask(t.id, DATE, 600, 0, [], clock).endMin).toBe(615);
  });
});

describe('recalculateDay', () => {
  function day(): PlanSnapshot & { intro: string; lit: string; cards: string } {
    const w = aWorld(clock);
    const blocks = [
      aBlock({ date: DATE, startMin: 540, endMin: 600, taskId: w.ids.intro.id }, clock), // elapsed
      aBlock(
        { date: DATE, startMin: 780, endMin: 840, taskId: w.ids.cards.id, locked: true },
        clock,
      ),
      aBlock({ date: DATE, startMin: 900, endMin: 960, taskId: w.ids.lit.id }, clock), // future planner
    ];
    return { ...w, blocks, intro: w.ids.intro.id, lit: w.ids.lit.id, cards: w.ids.cards.id };
  }

  it('after 14:00 never changes blocks before 14:00, keeps locked ones, refills the rest', () => {
    const s = day();
    const at1400 = fixedClock(new Date(2026, 8, 14, 14, 0));
    const r = recalculateDay(s, DATE, {}, at1400);
    expect(r.frozen.map((b) => b.taskId).sort()).toEqual([s.cards, s.intro].sort());
    expect(r.removed.map((b) => b.taskId)).toEqual([s.lit]);
    for (const b of r.created) expect(b.startMin).toBeGreaterThanOrEqual(840);
    for (const b of r.created) expect(b.endMin <= 780 || b.startMin >= 840).toBe(true);
    // The elapsed and locked tasks are not planned again.
    expect(r.created.map((b) => b.taskId)).not.toContain(s.intro);
    expect(r.created.map((b) => b.taskId)).not.toContain(s.cards);
    expect(r.created.map((b) => b.taskId)).toContain(s.lit);
    expect(r.summary.kept).toBe(2);
    expect(summarizeRecalc(r)).toMatch(/kept/);
  });

  it('reports moved and unchanged blocks', () => {
    const s = day();
    const r = recalculateDay(s, DATE, {}, testClock()); // planned from Saturday: nothing elapsed
    expect(r.removed).toHaveLength(2);
    expect(r.summary.moved + r.summary.unchanged).toBe(2);
    const empty = recalculateDay({ ...s, blocks: [] }, DATE, {}, testClock());
    expect(empty.summary.kept).toBe(0);
  });
});
