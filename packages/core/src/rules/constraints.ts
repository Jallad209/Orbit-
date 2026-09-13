import { dayOfWeek } from '../dates';
import type { BusyInterval, FreeInterval } from '../planner/types';
import type { LocalDate, Rule, Weekday } from '../schema';
import { rulesInOrder } from './order';

/**
 * Constraint rules shape the day's capacity before scoring sees it:
 * `reserve` either blocks a window outright (no area) or pins it to one
 * area; `noHighEnergyAfter` clears the high-energy flag from everything
 * after the cut. Pure over intervals; the capacity builder calls this.
 */

export const WEEKDAYS: readonly Weekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function weekdayOf(date: LocalDate): Weekday {
  return WEEKDAYS[dayOfWeek(date)]!;
}

/** Split intervals at `at` so a constraint can apply to one side only. */
export function splitAt(intervals: FreeInterval[], at: number): FreeInterval[] {
  const out: FreeInterval[] = [];
  for (const i of intervals) {
    if (at > i.startMin && at < i.endMin) {
      out.push({ ...i, endMin: at }, { ...i, startMin: at });
    } else out.push(i);
  }
  return out;
}

export interface ConstrainedCapacity {
  free: FreeInterval[];
  /** Reserved windows with no area: busy time the caller subtracts. */
  busy: BusyInterval[];
}

/** Enabled, live constraint rules. */
export function constraintRules(rules: readonly Rule[]) {
  return rulesInOrder(rules).filter(
    (r): r is Extract<Rule, { type: 'constraint' }> =>
      r.deletedAt === null && r.enabled && r.type === 'constraint',
  );
}

/**
 * Apply every enabled constraint rule that touches `date` to the free
 * intervals. Returns the shaped intervals plus the busy windows that whole
 * reservations produce.
 */
export function applyConstraints(
  free: FreeInterval[],
  rules: readonly Rule[],
  date: LocalDate,
): ConstrainedCapacity {
  const weekday = weekdayOf(date);
  const busy: BusyInterval[] = [];
  const reserved: Array<{ startMin: number; endMin: number }> = [];
  let out = free;
  for (const rule of constraintRules(rules)) {
    const c = rule.config;
    if (c.kind === 'reserve' && c.dayOfWeek === weekday) {
      // Earlier reservations own their overlap, whether reserved for an area or fully busy.
      let pieces = [{ startMin: c.startMin, endMin: c.endMin }];
      for (const earlier of reserved) {
        pieces = pieces.flatMap((piece) => {
          if (piece.endMin <= earlier.startMin || piece.startMin >= earlier.endMin) return [piece];
          return [
            ...(piece.startMin < earlier.startMin
              ? [{ startMin: piece.startMin, endMin: earlier.startMin }]
              : []),
            ...(piece.endMin > earlier.endMin
              ? [{ startMin: earlier.endMin, endMin: piece.endMin }]
              : []),
          ];
        });
      }
      reserved.push({ startMin: c.startMin, endMin: c.endMin });
      for (const piece of pieces) {
        if (c.areaId === null) {
          busy.push({
            ...piece,
            kind: 'reserve',
            refId: rule.id,
            label: c.label || rule.name || 'Reserved',
          });
        } else {
          out = splitAt(splitAt(out, piece.startMin), piece.endMin).map((i) =>
            i.startMin >= piece.startMin && i.endMin <= piece.endMin
              ? { ...i, areaId: c.areaId, reservedBy: rule.id }
              : i,
          );
        }
      }
    }
    if (c.kind === 'noHighEnergyAfter') {
      out = splitAt(out, c.afterMin).map((i) =>
        i.startMin >= c.afterMin ? { ...i, highEnergyAllowed: false } : i,
      );
    }
  }
  return { free: out, busy };
}
