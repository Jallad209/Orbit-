import { localRange } from '../planner/capacity';
import type { FreeInterval } from '../planner/types';
import { applyConstraints } from '../rules/constraints';
import type { Event, LocalDate, Rule } from '../schema';
import type {
  AreaReservation,
  CapacityEvidence,
  CapacityExclusion,
  InsightPlanning,
} from './types';

/**
 * A date's work capacity for the whole day, as the overload and weekly
 * deficit insights compare against. This is deliberately not
 * `buildCapacity().freeMin`: the planner's number also subtracts fixed
 * work blocks (that is demand here, and would be charged twice) and the
 * time already passed today (which would make every afternoon look
 * overloaded). Rest boundaries, calendar events, and whole reservations
 * are excluded once each, overlaps counted once; area reservations stay
 * usable time; energy rules limit what goes where, not how much.
 */

interface Interval {
  startMin: number;
  endMin: number;
}

function clip(i: Interval, window: Interval): Interval | null {
  const startMin = Math.max(i.startMin, window.startMin);
  const endMin = Math.min(i.endMin, window.endMin);
  return endMin > startMin ? { startMin, endMin } : null;
}

/** Total length of the union of intervals: overlaps count once. */
export function unionMinutes(intervals: readonly Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  let total = 0;
  let cursor = -1;
  for (const i of sorted) {
    const start = Math.max(i.startMin, cursor);
    if (i.endMin > start) {
      total += i.endMin - start;
      cursor = i.endMin;
    }
  }
  return total;
}

export function fullDayCapacity(
  date: LocalDate,
  planning: InsightPlanning,
  rules: readonly Rule[],
  events: readonly Event[],
): CapacityEvidence {
  const window = planning.workingWindow;
  const windowMin = Math.max(0, window.endMin - window.startMin);
  const exclusions: CapacityExclusion[] = [];

  for (const r of planning.restBoundaries) {
    const c = clip(r, window);
    if (c) exclusions.push({ kind: 'rest', label: 'Rest', refId: null, ...c });
  }
  for (const e of [...events].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (e.deletedAt !== null) continue;
    const r = localRange(e.startAt, e.endAt, date);
    const c = r && clip(r, window);
    if (c) exclusions.push({ kind: 'event', label: e.title, refId: e.id, ...c });
  }

  // Constraint rules in their existing order: whole reservations become busy time,
  // area reservations keep their label on the free intervals.
  const free: FreeInterval[] = [
    { startMin: window.startMin, endMin: window.endMin, areaId: null, highEnergyAllowed: true },
  ];
  const constrained = applyConstraints(free, rules, date);
  for (const b of constrained.busy) {
    const c = clip(b, window);
    if (c) exclusions.push({ kind: 'reserve', label: b.label, refId: b.refId, ...c });
  }
  const areaReservations: AreaReservation[] = [];
  for (const i of constrained.free) {
    if (!i.areaId) continue;
    const rule = rules.find((r) => r.id === i.reservedBy);
    const label =
      rule?.type === 'constraint' && rule.config.kind === 'reserve'
        ? rule.config.label || rule.name || 'Reserved'
        : 'Reserved';
    areaReservations.push({
      ruleId: i.reservedBy ?? '',
      areaId: i.areaId,
      label,
      startMin: i.startMin,
      endMin: i.endMin,
    });
  }

  exclusions.sort(
    (a, b) =>
      a.startMin - b.startMin ||
      a.endMin - b.endMin ||
      a.kind.localeCompare(b.kind) ||
      (a.refId ?? '').localeCompare(b.refId ?? ''),
  );
  const excludedMin = unionMinutes(exclusions);
  return {
    kind: 'capacity',
    date,
    workingWindow: { ...window },
    windowMin,
    exclusions,
    excludedMin,
    areaReservations,
    availableMin: Math.max(0, windowMin - excludedMin),
  };
}
