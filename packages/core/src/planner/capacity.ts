import { dayOfWeek, minuteOfDay, toLocalDate } from '../dates';
import type { Block, Id, LocalDate, Weekday } from '../schema';
import type { BusyInterval, DayCapacity, FreeInterval, PlanSettings, PlanSnapshot } from './types';

const WEEKDAYS: Weekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function roundUpTo(min: number, grid: number): number {
  return Math.ceil(min / grid) * grid;
}

/** Minute-of-day range of an instant pair on `date`, clipped to the day; null when it misses the day. */
export function localRange(
  startAt: string,
  endAt: string,
  date: LocalDate,
): { startMin: number; endMin: number } | null {
  const s = new Date(startAt);
  const e = new Date(endAt);
  const sd = toLocalDate(s);
  const ed = toLocalDate(e);
  if (ed < date || sd > date) return null;
  const startMin = sd < date ? 0 : minuteOfDay(s);
  const endMin = ed > date ? 1440 : minuteOfDay(e);
  return endMin > startMin ? { startMin, endMin } : null;
}

/** Subtract `[s, e)` from every interval, keeping constraint flags. */
function subtract(intervals: FreeInterval[], s: number, e: number): FreeInterval[] {
  const out: FreeInterval[] = [];
  for (const i of intervals) {
    if (e <= i.startMin || s >= i.endMin) {
      out.push(i);
      continue;
    }
    if (s > i.startMin) out.push({ ...i, endMin: s });
    if (e < i.endMin) out.push({ ...i, startMin: e });
  }
  return out;
}

/** Split intervals at `at` so a constraint can apply to one side only. */
function splitAt(intervals: FreeInterval[], at: number): FreeInterval[] {
  const out: FreeInterval[] = [];
  for (const i of intervals) {
    if (at > i.startMin && at < i.endMin) {
      out.push({ ...i, endMin: at }, { ...i, startMin: at });
    } else out.push(i);
  }
  return out;
}

/** Blocks the planner must not move: locked, or placed by hand. */
export function isFixedBlock(b: Block): boolean {
  return b.deletedAt === null && (b.locked || b.source === 'manual');
}

/**
 * Free intervals for a date: the working window minus rest boundaries,
 * events, fixed blocks, the past (when planning today), and constraint
 * rules. Constraints come first so scoring never sees time it cannot use.
 */
export function buildCapacity(
  snapshot: PlanSnapshot,
  date: LocalDate,
  settings: PlanSettings,
  now: Date,
): DayCapacity {
  const busy: BusyInterval[] = [];
  let free: FreeInterval[] = [
    {
      startMin: settings.workingWindow.startMin,
      endMin: settings.workingWindow.endMin,
      areaId: null,
      highEnergyAllowed: true,
    },
  ];

  for (const r of settings.restBoundaries) {
    busy.push({ ...r, kind: 'rest', refId: null, label: 'Rest' });
  }

  const taskTitle = new Map<Id, string>();
  for (const t of snapshot.tasks) taskTitle.set(t.id, t.title);

  for (const e of snapshot.events ?? []) {
    if (e.deletedAt !== null) continue;
    const r = localRange(e.startAt, e.endAt, date);
    if (r) busy.push({ ...r, kind: 'event', refId: e.id, label: e.title });
  }

  for (const b of snapshot.blocks ?? []) {
    if (b.date !== date || !isFixedBlock(b)) continue;
    const label = b.taskId ? (taskTitle.get(b.taskId) ?? 'Task') : b.eventId ? 'Event' : 'Block';
    busy.push({ startMin: b.startMin, endMin: b.endMin, kind: 'block', refId: b.id, label });
  }

  if (toLocalDate(now) === date) {
    const nowMin = roundUpTo(minuteOfDay(now), settings.gridMin);
    if (nowMin > settings.workingWindow.startMin) {
      busy.push({
        startMin: settings.workingWindow.startMin,
        endMin: Math.min(nowMin, settings.workingWindow.endMin),
        kind: 'past',
        refId: null,
        label: 'Already passed',
      });
    }
  }

  const weekday = WEEKDAYS[dayOfWeek(date)]!;
  for (const rule of snapshot.rules ?? []) {
    if (rule.deletedAt !== null || !rule.enabled || rule.type !== 'constraint') continue;
    const c = rule.config;
    if (c.kind === 'reserve' && c.dayOfWeek === weekday) {
      if (c.areaId === null) {
        busy.push({
          startMin: c.startMin,
          endMin: c.endMin,
          kind: 'reserve',
          refId: rule.id,
          label: c.label || rule.name || 'Reserved',
        });
      } else {
        free = splitAt(splitAt(free, c.startMin), c.endMin).map((i) =>
          i.startMin >= c.startMin && i.endMin <= c.endMin ? { ...i, areaId: c.areaId } : i,
        );
      }
    }
    if (c.kind === 'noHighEnergyAfter') {
      free = splitAt(free, c.afterMin).map((i) =>
        i.startMin >= c.afterMin ? { ...i, highEnergyAllowed: false } : i,
      );
    }
  }

  for (const b of busy) free = subtract(free, b.startMin, b.endMin);

  free = free
    .filter((i) => i.endMin - i.startMin >= settings.minBlockMin)
    .sort((a, b) => a.startMin - b.startMin);
  busy.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  return {
    date,
    workingWindow: settings.workingWindow,
    free,
    busy,
    freeMin: free.reduce((sum, i) => sum + (i.endMin - i.startMin), 0),
  };
}

/** Tasks and routine instances already fixed on the day's timeline. */
export function fixedRefs(snapshot: PlanSnapshot, date: LocalDate): Set<Id> {
  const out = new Set<Id>();
  for (const b of snapshot.blocks ?? []) {
    if (b.date !== date || !isFixedBlock(b)) continue;
    if (b.taskId) out.add(b.taskId);
    if (b.routineInstanceId) out.add(b.routineInstanceId);
  }
  return out;
}
