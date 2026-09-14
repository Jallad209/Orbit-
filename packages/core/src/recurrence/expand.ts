import {
  addDays,
  dayOfWeek,
  daysInMonth,
  fromLocalDate,
  isValidLocalDate,
  toLocalDate,
} from '../dates';
import type { LocalDate, Recurrence, Weekday } from '../schema';

export interface DateRange {
  /** Inclusive. */
  from: LocalDate;
  /** Inclusive. */
  to: LocalDate;
}

const WEEKDAYS: Weekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** Offset of each weekday inside a Monday-based week: MO = 0 … SU = 6. */
const WEEK_OFFSET: Record<Weekday, number> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };

function weekdayOf(date: LocalDate): Weekday {
  return WEEKDAYS[dayOfWeek(date)]!;
}

/** Monday-based start of the week containing `date`. */
export function startOfWeek(date: LocalDate): LocalDate {
  const dow = dayOfWeek(date); // 0 = Sunday
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

function addMonthsClamped(anchor: LocalDate, months: number, day: number): LocalDate {
  const d = fromLocalDate(anchor);
  const y = d.getFullYear();
  const m = d.getMonth() + months;
  const target = new Date(y, m, 1);
  const last = daysInMonth(target.getFullYear(), target.getMonth() + 1);
  target.setDate(Math.min(day, last));
  return toLocalDate(target);
}

/**
 * The weekdays a weekly rule fires on, in chronological order within the
 * Monday-based week and without duplicates. The rule's own order and any
 * repeated weekday are presentation noise, not extra occurrences.
 */
export function weeklyDays(recurrence: Recurrence, anchor: LocalDate): Weekday[] {
  const days = recurrence.byDay.length ? recurrence.byDay : [weekdayOf(anchor)];
  return [...new Set(days)].sort((a, b) => WEEK_OFFSET[a] - WEEK_OFFSET[b]);
}

/**
 * Every date the rule produces from `anchor` on, oldest first and without
 * end: COUNT and UNTIL are the caller's cut-offs, so one enumeration serves
 * both range expansion and "the occurrence after position n". Monthly on
 * the 31st lands on the last day of shorter months rather than being
 * skipped, which is what bills need; the anchor's own day never moves.
 */
export function* occurrences(recurrence: Recurrence, anchor: LocalDate): Generator<LocalDate> {
  const interval = Math.max(1, recurrence.interval);
  if (recurrence.freq === 'daily') {
    for (let d = anchor; ; d = addDays(d, interval)) yield d;
  }
  if (recurrence.freq === 'weekly') {
    // Walk week by week from the anchor's week, Monday to Sunday, so a Sunday and a Monday
    // of one week come out in calendar order; the anchor itself is the first candidate.
    const offsets = weeklyDays(recurrence, anchor).map((w) => WEEK_OFFSET[w]);
    for (let weekStart = startOfWeek(anchor); ; weekStart = addDays(weekStart, 7 * interval)) {
      for (const offset of offsets) {
        const date = addDays(weekStart, offset);
        if (date >= anchor) yield date;
      }
    }
  }
  // monthly
  const day = recurrence.byMonthDay ?? fromLocalDate(anchor).getDate();
  for (let i = 0; ; i += interval) {
    const date = addMonthsClamped(anchor, i, day);
    if (i === 0 && date < anchor) continue;
    yield date;
  }
}

/**
 * Every occurrence of a recurrence inside `range`, oldest first. A subset of
 * RRULE: DAILY / WEEKLY / MONTHLY with INTERVAL, BYDAY (weekly), BYMONTHDAY
 * (monthly), COUNT and UNTIL (inclusive). `anchor` is the routine's start
 * date; COUNT counts from it.
 */
export function expandRecurrence(
  recurrence: Recurrence,
  anchor: LocalDate,
  range: DateRange,
): LocalDate[] {
  const out: LocalDate[] = [];
  const until = recurrence.until && recurrence.until < range.to ? recurrence.until : range.to;
  const count = recurrence.count ?? Infinity;
  let produced = 0;
  for (const date of occurrences(recurrence, anchor)) {
    if (date > until) break;
    produced += 1;
    if (produced > count) break;
    if (date >= range.from) out.push(date);
  }
  return out;
}

/** True when `date` is an occurrence. */
export function occursOn(recurrence: Recurrence, anchor: LocalDate, date: LocalDate): boolean {
  return expandRecurrence(recurrence, anchor, { from: date, to: date }).length > 0;
}

/** The last calendar date Orbit's four-digit `LocalDate` can express. */
export const MAX_LOCAL_DATE: LocalDate = '9999-12-31';

export type NextOccurrence =
  | { kind: 'next'; date: LocalDate; index: number }
  /** The rule ends before the next position: COUNT reached or UNTIL passed. */
  | { kind: 'exhausted'; reason: 'count' | 'until' }
  /** The rule cannot produce a next date: an arithmetic or calendar bound was hit. */
  | { kind: 'invalid'; message: string };

/**
 * The occurrence after zero-based position `index` under a rule anchored
 * at `anchor` (week 12, for bills). Bounded: it enumerates exactly
 * `index + 2` dates, never "until some distant year", and reports a rule
 * that runs off the calendar as invalid rather than as finished. COUNT is
 * measured from the anchor — position `count − 1` is the last one — and
 * UNTIL is inclusive.
 */
export function nextOccurrence(
  recurrence: Recurrence,
  anchor: LocalDate,
  index: number,
): NextOccurrence {
  if (!Number.isInteger(index) || index < 0) {
    return { kind: 'invalid', message: 'The occurrence position must be a whole number ≥ 0.' };
  }
  if (!isValidLocalDate(anchor)) return { kind: 'invalid', message: 'The anchor is not a date.' };
  if (!Number.isInteger(recurrence.interval) || recurrence.interval < 1) {
    return { kind: 'invalid', message: 'The interval must be a whole number ≥ 1.' };
  }
  const next = index + 1;
  if (recurrence.count !== null && next >= recurrence.count) {
    return { kind: 'exhausted', reason: 'count' };
  }
  // A step so large that even one interval leaves the calendar is invalid, whatever the
  // position asked for; checking before enumerating keeps the loop from ever running long.
  const stepDays =
    recurrence.freq === 'daily'
      ? recurrence.interval
      : recurrence.freq === 'weekly'
        ? 7 * recurrence.interval
        : 31 * recurrence.interval;
  if (stepDays * next > 4_000_000) {
    return { kind: 'invalid', message: 'This schedule runs past the year 9999.' };
  }
  let position = 0;
  for (const date of occurrences(recurrence, anchor)) {
    if (!isValidLocalDate(date) || date > MAX_LOCAL_DATE) {
      return { kind: 'invalid', message: 'This schedule runs past the year 9999.' };
    }
    if (position === next) {
      if (recurrence.until !== null && date > recurrence.until) {
        return { kind: 'exhausted', reason: 'until' };
      }
      return { kind: 'next', date, index: next };
    }
    position += 1;
  }
  return { kind: 'invalid', message: 'The schedule produced no date.' };
}

/** The date at zero-based `index`, or null when the rule ends before it. */
export function occurrenceAt(
  recurrence: Recurrence,
  anchor: LocalDate,
  index: number,
): LocalDate | null {
  let position = 0;
  if (!Number.isInteger(index) || index < 0) return null;
  if (recurrence.count !== null && index >= recurrence.count) return null;
  for (const date of occurrences(recurrence, anchor)) {
    if (!isValidLocalDate(date) || date > MAX_LOCAL_DATE) return null;
    if (position === index)
      return recurrence.until !== null && date > recurrence.until ? null : date;
    position += 1;
  }
  return null;
}
