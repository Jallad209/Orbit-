import { dayOfWeek } from '../dates';
import type { BusyInterval, FreeInterval } from '../planner/types';
import type { LocalDate, Rule, Weekday } from '../schema';

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
  return rules.filter(
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
  let out = free;
  for (const rule of constraintRules(rules)) {
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
        out = splitAt(splitAt(out, c.startMin), c.endMin).map((i) =>
          i.startMin >= c.startMin && i.endMin <= c.endMin ? { ...i, areaId: c.areaId } : i,
        );
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
