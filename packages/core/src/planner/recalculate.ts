import type { Clock } from '../clock';
import { systemClock } from '../clock';
import { minuteOfDay, toLocalDate } from '../dates';
import { createRecord } from '../records';
import { BlockSchema } from '../schema';
import type { Block, Id, LocalDate } from '../schema';
import { planDay } from './index';
import type { PlanProposal, PlanSettings, PlanSnapshot } from './types';

export interface RecalcResult {
  proposal: PlanProposal;
  /** Blocks that were not touched: locked, manual, elapsed, or in progress. */
  frozen: Block[];
  /** Unlocked planner blocks that were re-planned (to soft-delete). */
  removed: Block[];
  /** Their replacements, ready to store. */
  created: Block[];
  summary: { moved: number; unchanged: number; kept: number; dropped: number };
}

/**
 * Re-plan the rest of a day after the user moves, resizes, locks, or
 * completes something. Everything that has already happened, or that the
 * user placed by hand or locked, is frozen; only future planner blocks are
 * refilled. Blocks before `now` are therefore never changed.
 */
export function recalculateDay(
  snapshot: PlanSnapshot,
  date: LocalDate,
  settings: Partial<PlanSettings> = {},
  clock: Clock = systemClock,
): RecalcResult {
  const now = clock.now();
  const nowMin = toLocalDate(now) === date ? minuteOfDay(now) : null;
  const todays = (snapshot.blocks ?? []).filter((b) => b.deletedAt === null && b.date === date);
  const doneTasks = new Set(
    snapshot.tasks.filter((t) => t.status === 'done' || t.status === 'archived').map((t) => t.id),
  );

  const frozen: Block[] = [];
  const removed: Block[] = [];
  for (const b of todays) {
    const fixed = b.locked || b.source === 'manual';
    const started = nowMin !== null && b.startMin < nowMin;
    if (fixed || started) frozen.push(b);
    else removed.push(b);
  }

  // The planner sees frozen blocks as locked and the rest as absent.
  const frozenIds = new Set(frozen.map((b) => b.id));
  const view: PlanSnapshot = {
    ...snapshot,
    blocks: (snapshot.blocks ?? [])
      .map((b) => (frozenIds.has(b.id) ? { ...b, locked: true } : b))
      .filter((b) => b.date !== date || frozenIds.has(b.id)),
  };
  // Only the displaced work is re-placed; free time is not filled with new tasks.
  const candidateIds = removed
    .map((b) => b.taskId ?? b.routineInstanceId)
    .filter((id): id is Id => !!id);
  const proposal = planDay(view, date, { ...settings, candidateIds }, clock);

  const created = proposal.blocks
    .filter((b) => b.kind === 'task' || b.kind === 'routine')
    .map((b) =>
      createRecord(BlockSchema, clock, {
        date,
        startMin: b.startMin,
        endMin: b.endMin,
        taskId: b.taskId,
        routineInstanceId: b.routineInstanceId,
        eventId: null,
        locked: false,
        source: 'planner',
      }),
    );

  const before = new Map<Id, Block>();
  for (const b of removed) before.set(b.taskId ?? b.routineInstanceId ?? b.id, b);
  let moved = 0;
  let unchanged = 0;
  const after = new Set<Id>();
  for (const b of created) {
    const key = b.taskId ?? b.routineInstanceId ?? b.id;
    after.add(key);
    const prev = before.get(key);
    if (!prev) continue;
    if (prev.startMin === b.startMin && prev.endMin === b.endMin) unchanged += 1;
    else moved += 1;
  }
  const dropped = [...before.keys()].filter((k) => !after.has(k) && !doneTasks.has(k)).length;

  return {
    proposal,
    frozen,
    removed,
    created,
    summary: { moved, unchanged, kept: frozen.length, dropped },
  };
}

export function summarizeRecalc(r: RecalcResult): string {
  const parts: string[] = [];
  if (r.summary.moved) parts.push(`${r.summary.moved} moved`);
  if (r.summary.unchanged) parts.push(`${r.summary.unchanged} unchanged`);
  if (r.summary.kept) parts.push(`${r.summary.kept} kept`);
  if (r.summary.dropped) parts.push(`${r.summary.dropped} no longer fit`);
  return parts.length ? parts.join(', ') : 'Nothing to re-plan';
}
