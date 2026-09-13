import type { Clock } from '../clock';
import { nowIso } from '../clock';
import { formatMinute } from '../dates';
import { createRecord } from '../records';
import { BlockSchema } from '../schema';
import type { Block, Event, Id, LocalDate } from '../schema';
import { localRange } from '../planner/capacity';

export const GRID_MIN = 15;
export const MIN_BLOCK_MIN = 15;

export type BlockErrorCode = 'locked' | 'overlap' | 'too-short' | 'out-of-day' | 'split-point';

export class BlockError extends Error {
  constructor(
    public readonly code: BlockErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BlockError';
  }
}

export function snapToGrid(min: number, grid = GRID_MIN): number {
  return Math.round(min / grid) * grid;
}

export function overlaps(
  a: { startMin: number; endMin: number },
  b: { startMin: number; endMin: number },
): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/** Blocks the planner and the user cannot move: locked, or placed by hand. */
export function isFixed(b: Block): boolean {
  return b.locked || b.source === 'manual';
}

export interface Obstacle {
  startMin: number;
  endMin: number;
  label: string;
}

/**
 * What a moved or resized block may not overlap on its day: fixed blocks and
 * events. Unlocked planner blocks are not obstacles; recalculation re-places them.
 */
export function obstaclesFor(
  date: LocalDate,
  blocks: readonly Block[],
  events: readonly Event[],
  titles: ReadonlyMap<Id, string>,
  exceptId?: Id,
): Obstacle[] {
  const out: Obstacle[] = [];
  for (const b of blocks) {
    if (b.deletedAt !== null || b.date !== date || b.id === exceptId || !isFixed(b)) continue;
    out.push({
      startMin: b.startMin,
      endMin: b.endMin,
      label: b.taskId ? (titles.get(b.taskId) ?? 'a locked block') : 'a locked block',
    });
  }
  for (const e of events) {
    if (e.deletedAt !== null) continue;
    const r = localRange(e.startAt, e.endAt, date);
    if (r) out.push({ ...r, label: e.title });
  }
  return out;
}

export function validatePlacement(
  range: { startMin: number; endMin: number },
  obstacles: readonly Obstacle[],
): void {
  if (range.startMin < 0 || range.endMin > 1440)
    throw new BlockError('out-of-day', 'A block has to stay inside the day.');
  if (range.endMin - range.startMin < MIN_BLOCK_MIN)
    throw new BlockError('too-short', `Blocks are at least ${MIN_BLOCK_MIN} minutes.`);
  const hit = obstacles.find((o) => overlaps(range, o));
  if (hit) {
    throw new BlockError(
      'overlap',
      `That would overlap ${hit.label} (${formatMinute(hit.startMin)}–${formatMinute(hit.endMin)}).`,
    );
  }
}

/** Move keeps the length; the result is a manual block so recalculation leaves it alone. */
export function moveBlock(block: Block, startMin: number, obstacles: readonly Obstacle[]): Block {
  if (block.locked) throw new BlockError('locked', 'Unlock the block to move it.');
  const start = snapToGrid(startMin);
  const length = block.endMin - block.startMin;
  const range = { startMin: start, endMin: start + length };
  validatePlacement(range, obstacles);
  return { ...block, ...range, source: 'manual' };
}

export function resizeBlock(
  block: Block,
  edge: 'start' | 'end',
  minute: number,
  obstacles: readonly Obstacle[],
): Block {
  if (block.locked) throw new BlockError('locked', 'Unlock the block to resize it.');
  const m = snapToGrid(minute);
  const range =
    edge === 'end'
      ? { startMin: block.startMin, endMin: m }
      : { startMin: m, endMin: block.endMin };
  validatePlacement(range, obstacles);
  return { ...block, ...range, source: 'manual' };
}

export function lockBlock(block: Block): Block {
  return { ...block, locked: true };
}

export function unlockBlock(block: Block): Block {
  return { ...block, locked: false };
}

/** Two blocks from one; both keep the reference and the lock state. */
export function splitBlock(block: Block, atMin: number, clock: Clock): [Block, Block] {
  const at = snapToGrid(atMin);
  if (at - block.startMin < MIN_BLOCK_MIN || block.endMin - at < MIN_BLOCK_MIN) {
    throw new BlockError('split-point', 'Both halves have to be at least 15 minutes.');
  }
  const first: Block = { ...block, endMin: at, updatedAt: nowIso(clock) };
  const second = createRecord(BlockSchema, clock, {
    date: block.date,
    startMin: at,
    endMin: block.endMin,
    taskId: block.taskId,
    routineInstanceId: block.routineInstanceId,
    eventId: block.eventId,
    locked: block.locked,
    source: block.source,
  });
  return [first, second];
}

/** A new manual block for a task dropped onto free time. */
export function placeTask(
  taskId: Id,
  date: LocalDate,
  startMin: number,
  lengthMin: number,
  obstacles: readonly Obstacle[],
  clock: Clock,
): Block {
  const start = snapToGrid(startMin);
  const length = Math.max(MIN_BLOCK_MIN, Math.ceil(lengthMin / GRID_MIN) * GRID_MIN);
  const range = { startMin: start, endMin: start + length };
  validatePlacement(range, obstacles);
  return createRecord(BlockSchema, clock, {
    date,
    ...range,
    taskId,
    locked: false,
    source: 'manual',
  });
}
