import { addDays, dayOfWeek, daysInMonth, fromLocalDate, toLocalDate } from '../dates';
import type { LocalDate, Recurrence, Weekday } from '../schema';

export interface DateRange {
  /** Inclusive. */
  from: LocalDate;
  /** Inclusive. */
  to: LocalDate;
}

const WEEKDAYS: Weekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

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
 * Every occurrence of a recurrence inside `range`, oldest first. A subset of
 * RRULE: DAILY / WEEKLY / MONTHLY with INTERVAL, BYDAY (weekly), BYMONTHDAY
 * (monthly), COUNT and UNTIL. Monthly on the 31st lands on the last day of
 * shorter months rather than being skipped, which is what bills need.
 * `anchor` is the routine's start date; COUNT counts from it.
 */
export function expandRecurrence(
  recurrence: Recurrence,
  anchor: LocalDate,
  range: DateRange,
): LocalDate[] {
  const out: LocalDate[] = [];
  const interval = Math.max(1, recurrence.interval);
  const until = recurrence.until && recurrence.until < range.to ? recurrence.until : range.to;
  const count = recurrence.count ?? Infinity;
  let produced = 0;
  const push = (date: LocalDate): boolean => {
    if (date > until) return false;
    produced += 1;
    if (produced > count) return false;
    if (date >= range.from) out.push(date);
    return true;
  };

  if (recurrence.freq === 'daily') {
    for (let d = anchor; ; d = addDays(d, interval)) if (!push(d)) break;
    return out;
  }

  if (recurrence.freq === 'weekly') {
    const days = recurrence.byDay.length ? recurrence.byDay : [weekdayOf(anchor)];
    const order = days.map((w) => WEEKDAYS.indexOf(w)).sort((a, b) => a - b);
    // Walk week by week from the anchor's week; the anchor itself is the first candidate.
    let weekStart = startOfWeek(anchor);
    for (;;) {
      let stop = false;
      for (const dow of order) {
        const date = addDays(weekStart, dow === 0 ? 6 : dow - 1);
        if (date < anchor) continue;
        if (!push(date)) {
          stop = true;
          break;
        }
      }
      if (stop) break;
      weekStart = addDays(weekStart, 7 * interval);
      if (weekStart > until) break;
    }
    return out;
  }

  // monthly
  const day = recurrence.byMonthDay ?? fromLocalDate(anchor).getDate();
  for (let i = 0; ; i += interval) {
    const date = addMonthsClamped(anchor, i, day);
    if (i === 0 && date < anchor) continue;
    if (!push(date)) break;
  }
  return out;
}

/** True when `date` is an occurrence. */
export function occursOn(recurrence: Recurrence, anchor: LocalDate, date: LocalDate): boolean {
  return expandRecurrence(recurrence, anchor, { from: date, to: date }).length > 0;
}
