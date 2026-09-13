import {
  lockBlock,
  localRange,
  moveBlock,
  obstaclesFor,
  overlaps,
  placeTask,
  recalculateDay,
  resizeBlock,
  summarizeRecalc,
  systemClock,
  toLocalDate,
  unlockBlock,
} from '@orbit/core';
import type {
  Block,
  Clock,
  Event,
  Id,
  LocalDate,
  Obstacle,
  PlanSettings,
  Routine,
  RoutineInstance,
  Task,
  TimeWindow,
} from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { bumpData } from '@/data/useQuery';
import { ensureRoutineInstances } from '@/data/routineInstances';

export interface DayData {
  date: LocalDate;
  now: Date;
  isToday: boolean;
  blocks: Block[];
  events: Event[];
  /** Events of the day as minute ranges, for drawing. */
  eventRanges: Array<{ event: Event; startMin: number; endMin: number }>;
  taskById: Map<Id, Task>;
  instanceTitle: Map<Id, string>;
  /** Open, ready tasks without a block on this date. */
  unscheduled: Task[];
  titles: Map<Id, string>;
}

export async function loadDay(
  repo: Repository,
  date: LocalDate,
  clock: Clock = systemClock,
): Promise<DayData> {
  await ensureRoutineInstances(repo, clock);
  const [blocks, events, tasks, routines, instances] = await Promise.all([
    repo.blocks.query((b) => b.date === date),
    repo.events.list(),
    repo.tasks.list(),
    repo.routines.list(),
    repo.routineInstances.query((i) => i.date === date),
  ]);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const routineTitle = new Map<Id, string>((routines as Routine[]).map((r) => [r.id, r.title]));
  const instanceTitle = new Map<Id, string>(
    (instances as RoutineInstance[]).map((i) => [i.id, routineTitle.get(i.routineId) ?? 'Routine']),
  );
  const titles = new Map<Id, string>();
  for (const t of tasks) titles.set(t.id, t.title);
  for (const [id, title] of instanceTitle) titles.set(id, title);

  const scheduled = new Set(blocks.map((b) => b.taskId).filter((x): x is Id => !!x));
  const unscheduled = tasks
    .filter((t) => t.status === 'open' && !scheduled.has(t.id))
    .sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));

  const eventRanges = events
    .map((event) => ({ event, range: localRange(event.startAt, event.endAt, date) }))
    .filter((x): x is { event: Event; range: { startMin: number; endMin: number } } => !!x.range)
    .map((x) => ({ event: x.event, ...x.range }));

  const now = clock.now();
  return {
    date,
    now,
    isToday: toLocalDate(now) === date,
    blocks: blocks.sort((a, b) => a.startMin - b.startMin),
    events,
    eventRanges,
    taskById,
    instanceTitle,
    unscheduled,
    titles,
  };
}

function obstacles(day: DayData, exceptId?: Id): Obstacle[] {
  return obstaclesFor(day.date, day.blocks, day.events, day.titles, exceptId);
}

/** Re-plan the rest of the day and store the result. Returns a one-line summary. */
export async function recalculate(
  repo: Repository,
  date: LocalDate,
  settings: Partial<PlanSettings>,
  clock: Clock = systemClock,
): Promise<string> {
  await ensureRoutineInstances(repo, clock);
  const [
    areas,
    goals,
    projects,
    tasks,
    events,
    routines,
    routineInstances,
    blocks,
    sessions,
    rules,
  ] = await Promise.all([
    repo.areas.list(),
    repo.goals.list(),
    repo.projects.list(),
    repo.tasks.list(),
    repo.events.list(),
    repo.routines.list(),
    repo.routineInstances.list(),
    repo.blocks.list(),
    repo.sessions.list(),
    repo.rules.list(),
  ]);
  const result = recalculateDay(
    { areas, goals, projects, tasks, events, routines, routineInstances, blocks, sessions, rules },
    date,
    settings,
    clock,
  );
  if (result.removed.length || result.created.length) {
    await repo.transaction(async (tx) => {
      for (const b of result.removed) await tx.blocks.softDelete(b.id);
      for (const b of result.created) await tx.blocks.upsert(b);
    });
  }
  bumpData();
  return summarizeRecalc(result);
}

export interface ChangeOutcome {
  block: Block;
  summary: string;
}

export async function moveBlockTo(
  repo: Repository,
  day: DayData,
  block: Block,
  startMin: number,
  settings: Partial<PlanSettings>,
  clock: Clock = systemClock,
): Promise<ChangeOutcome> {
  const next = moveBlock(block, startMin, obstacles(day, block.id));
  await repo.blocks.upsert(next);
  const summary = await recalculate(repo, day.date, settings, clock);
  return { block: next, summary };
}

export async function resizeBlockTo(
  repo: Repository,
  day: DayData,
  block: Block,
  edge: 'start' | 'end',
  minute: number,
  settings: Partial<PlanSettings>,
  clock: Clock = systemClock,
): Promise<ChangeOutcome> {
  const next = resizeBlock(block, edge, minute, obstacles(day, block.id));
  await repo.blocks.upsert(next);
  const summary = await recalculate(repo, day.date, settings, clock);
  return { block: next, summary };
}

export async function toggleLock(repo: Repository, block: Block): Promise<Block> {
  const next = await repo.blocks.upsert(block.locked ? unlockBlock(block) : lockBlock(block));
  bumpData();
  return next;
}

export async function removeBlock(
  repo: Repository,
  day: DayData,
  block: Block,
  settings: Partial<PlanSettings>,
  clock: Clock = systemClock,
): Promise<string> {
  await repo.blocks.softDelete(block.id);
  return recalculate(repo, day.date, settings, clock);
}

/** A task dropped onto the canvas becomes a manual block at the snapped minute. */
export async function dropTask(
  repo: Repository,
  day: DayData,
  task: Task,
  startMin: number,
  settings: Partial<PlanSettings>,
  clock: Clock = systemClock,
): Promise<ChangeOutcome> {
  const block = placeTask(task.id, day.date, startMin, task.estimateMin, obstacles(day), clock);
  await repo.blocks.upsert(block);
  const summary = await recalculate(repo, day.date, settings, clock);
  return { block, summary };
}

/** Earliest grid slot inside the working window, after now, that holds `lengthMin` without overlap. */
export function firstFreeSlot(
  day: DayData,
  lengthMin: number,
  window: TimeWindow,
  nowMin: number | null,
): number | null {
  const taken = [
    ...day.blocks.map((b) => ({ startMin: b.startMin, endMin: b.endMin })),
    ...day.eventRanges,
  ];
  const length = Math.max(15, Math.ceil(lengthMin / 15) * 15);
  let start = window.startMin;
  if (nowMin !== null) start = Math.max(start, Math.ceil(nowMin / 15) * 15);
  for (; start + length <= window.endMin; start += 15) {
    const range = { startMin: start, endMin: start + length };
    if (!taken.some((t) => overlaps(range, t))) return start;
  }
  return null;
}

export function blockTitle(day: DayData, b: Block): string {
  if (b.taskId) return day.taskById.get(b.taskId)?.title ?? 'Task';
  if (b.routineInstanceId) return day.instanceTitle.get(b.routineInstanceId) ?? 'Routine';
  return 'Block';
}
