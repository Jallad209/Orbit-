import { addDays } from '../dates';
import { roundUpTo } from '../planner/capacity';
import type { Id, InsightSettings, LocalDate } from '../schema';
import { fullDayCapacity } from './capacity';
import { byId, fingerprint } from './fingerprint';
import type { InsightIndex } from './snapshot';
import type {
  BlockEvidence,
  CapacityEvidence,
  Insight,
  InsightPlanning,
  InsightSnapshot,
  UnscheduledTaskEvidence,
} from './types';
import { INSIGHT_ALGORITHM_VERSION } from './types';

/**
 * How much work a date holds against how much room it has. Demand is every
 * stored work block by its own length (overlaps add up: they are competing
 * commitments), plus the estimate of each accepted task that has no block
 * left on the date. Event blocks are not demand: their event already
 * reduced the capacity. Finished work stays: this measures what the day
 * was booked with, not what remains.
 */

export const OVERLOAD_HORIZON_DAYS = 7;

export const WORKLOAD_NOTE =
  'Workload comparison only. Buffers, fragmented gaps, area reservations, and energy restrictions can make a plan infeasible even below this threshold.';

export interface DayLoad {
  date: LocalDate;
  capacity: CapacityEvidence;
  blocks: BlockEvidence[];
  unscheduled: UnscheduledTaskEvidence[];
  /** Sum of the block lengths and the unscheduled estimates. */
  demandMin: number;
  /** demand ÷ available; null when the day has no available time. */
  ratio: number | null;
  /** demand > available × ratio, or demand > 0 with no available time. */
  overloaded: boolean;
  fingerprint: string;
}

function outside(b: { startMin: number; endMin: number }, w: { startMin: number; endMin: number }) {
  return b.startMin < w.startMin || b.endMin > w.endMin;
}

export function computeDayLoad(
  date: LocalDate,
  snapshot: InsightSnapshot,
  index: InsightIndex,
  planning: InsightPlanning,
  settings: Pick<InsightSettings, 'dayOverloadRatio'>,
): DayLoad {
  const capacity = fullDayCapacity(date, planning, snapshot.rules, snapshot.events);
  const window = planning.workingWindow;
  const gridMin = planning.gridMin ?? 15;
  const minBlockMin = planning.minBlockMin ?? 15;

  const blocks: BlockEvidence[] = [];
  const blockedTasks = new Set<Id>();
  for (const b of [...(index.blocksByDate.get(date) ?? [])].sort(byId)) {
    if (b.eventId) continue;
    const minutes = b.endMin - b.startMin;
    if (b.taskId) {
      const task = index.taskById.get(b.taskId);
      if (!task || task.status === 'archived') continue;
      blockedTasks.add(task.id);
      blocks.push({
        kind: 'block',
        ref: { type: 'task', id: task.id },
        blockId: b.id,
        date,
        startMin: b.startMin,
        endMin: b.endMin,
        minutes,
        title: task.title,
        source: 'task',
        outsideWindow: outside(b, window),
        finished: task.status === 'done',
      });
    } else if (b.routineInstanceId) {
      const instance = index.instanceById.get(b.routineInstanceId);
      const routine = instance && index.routineById.get(instance.routineId);
      if (!instance || !routine || instance.status === 'skipped') continue;
      blocks.push({
        kind: 'block',
        ref: { type: 'routineInstance', id: instance.id },
        blockId: b.id,
        date,
        startMin: b.startMin,
        endMin: b.endMin,
        minutes,
        title: routine.title,
        source: 'routine',
        outsideWindow: outside(b, window),
        finished: instance.status === 'done',
      });
    } else {
      blocks.push({
        kind: 'block',
        ref: null,
        blockId: b.id,
        date,
        startMin: b.startMin,
        endMin: b.endMin,
        minutes,
        title: 'Manual block',
        source: 'manual',
        outsideWindow: outside(b, window),
        finished: false,
      });
    }
  }
  blocks.sort(
    (a, b) =>
      a.startMin - b.startMin || a.endMin - b.endMin || byId({ id: a.blockId }, { id: b.blockId }),
  );

  // Accepted tasks with no block left on the date, each once, whichever commitment lists them.
  const unscheduled: UnscheduledTaskEvidence[] = [];
  const seen = new Set<Id>();
  for (const c of [...(index.commitmentsByDate.get(date) ?? [])].sort(byId)) {
    for (const id of c.acceptedTaskIds) {
      if (seen.has(id) || blockedTasks.has(id)) continue;
      const task = index.taskById.get(id);
      if (!task || (task.status !== 'open' && task.status !== 'inbox')) continue;
      seen.add(id);
      const estimate = task.estimateMin > 0 ? task.estimateMin : planning.defaultEstimateMin;
      unscheduled.push({
        kind: 'unscheduled-task',
        ref: { type: 'task', id: task.id },
        title: task.title,
        date,
        estimateMin: task.estimateMin,
        minutes: roundUpTo(Math.max(estimate, minBlockMin), gridMin),
        commitmentId: c.id,
      });
    }
  }
  unscheduled.sort((a, b) => byId(a.ref, b.ref));

  const demandMin =
    blocks.reduce((sum, b) => sum + b.minutes, 0) +
    unscheduled.reduce((sum, u) => sum + u.minutes, 0);
  const available = capacity.availableMin;
  const ratio = available > 0 ? demandMin / available : null;
  const overloaded =
    available > 0 ? demandMin > available * settings.dayOverloadRatio : demandMin > 0;

  return {
    date,
    capacity,
    blocks,
    unscheduled,
    demandMin,
    ratio,
    overloaded,
    fingerprint: fingerprint({
      v: INSIGHT_ALGORITHM_VERSION,
      date,
      blocks: blocks.map((b) => [b.blockId, b.startMin, b.endMin, b.ref?.id ?? null, b.finished]),
      unscheduled: unscheduled.map((u) => [u.ref.id, u.minutes]),
      capacity: [
        capacity.workingWindow,
        capacity.exclusions.map((e) => [e.kind, e.refId, e.startMin, e.endMin]),
        capacity.areaReservations.map((r) => [r.ruleId, r.startMin, r.endMin]),
      ],
      ratio: settings.dayOverloadRatio,
      defaultEstimateMin: planning.defaultEstimateMin,
    }),
  };
}

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export function weekdayName(date: LocalDate): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAY_NAMES[new Date(y!, m! - 1, d!).getDay()]!;
}

/** Today and the six dates after it. */
export function overloadDates(today: LocalDate): LocalDate[] {
  return Array.from({ length: OVERLOAD_HORIZON_DAYS }, (_, i) => addDays(today, i));
}

export function overloadInsight(
  load: DayLoad,
  computedAt: string,
  settings: InsightSettings,
): Insight {
  const available = load.capacity.availableMin;
  const title =
    available > 0
      ? `${weekdayName(load.date)} has ${load.demandMin} minutes of committed work and ${available} minutes of available work time.`
      : `${weekdayName(load.date)} has ${load.demandMin} minutes of committed work and no available work time.`;
  const detail =
    available > 0
      ? `Committed work is ${Math.round((load.demandMin / available) * 100)}% of the day’s capacity; the limit is ${Math.round(settings.dayOverloadRatio * 100)}%.`
      : 'The working window is fully excluded by rest, events, or reservations on this date, yet work is booked.';
  return {
    key: `overloaded-day:${load.date}`,
    kind: 'overloaded-day',
    severity: 'risk',
    title,
    detail,
    subject: { type: 'date', date: load.date },
    evidence: [...load.blocks, ...load.unscheduled, load.capacity],
    // With no available time there is no ratio to show: any booked minute is over the line.
    threshold:
      load.ratio !== null
        ? {
            metric: 'committed/available',
            actual: load.ratio,
            operator: '>',
            limit: settings.dayOverloadRatio,
            unit: 'ratio',
            sampleSize: null,
            minSamples: null,
          }
        : {
            metric: 'committedMin',
            actual: load.demandMin,
            operator: '>',
            limit: 0,
            unit: 'minutes',
            sampleSize: null,
            minSamples: null,
          },
    metrics: {
      demandMin: load.demandMin,
      availableMin: available,
      ...(load.ratio !== null ? { ratio: load.ratio } : {}),
      blocks: load.blocks.length,
      unscheduled: load.unscheduled.length,
    },
    range: { from: load.date, to: load.date },
    notes: [WORKLOAD_NOTE],
    computedAt,
    fingerprint: load.fingerprint,
    algorithmVersion: INSIGHT_ALGORITHM_VERSION,
  };
}
