/**
 * Calendar-date helpers. Orbit stores instants as ISO strings (UTC) and
 * calendar dates as `YYYY-MM-DD` in the user's local zone. Never mix them.
 */

import type { LocalDate } from './schema/common';

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidLocalDate(value: string): boolean {
  const m = LOCAL_DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local calendar date of an instant. */
export function toLocalDate(d: Date): LocalDate {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local midnight of a calendar date. */
export function fromLocalDate(date: LocalDate): Date {
  const m = LOCAL_DATE_RE.exec(date);
  if (!m) throw new Error(`invalid local date: ${date}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = fromLocalDate(date);
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

/** 0 = Sunday … 6 = Saturday, matching `Date#getDay`. */
export function dayOfWeek(date: LocalDate): number {
  return fromLocalDate(date).getDay();
}

export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Minutes since local midnight for an instant. */
export function minuteOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** `HH:MM` for a minute-of-day. 1440 renders as 24:00. */
export function formatMinute(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/** Parse `HH:MM` (or `H:MM`) into minute-of-day. Throws on bad input. */
export function parseMinute(text: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) throw new Error(`invalid time: ${text}`);
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 24 || mm > 59 || (h === 24 && mm !== 0)) throw new Error(`invalid time: ${text}`);
  return h * 60 + mm;
}

/** Combine a local date and minute-of-day into an instant (local zone). */
export function toInstant(date: LocalDate, minute: number): Date {
  const d = fromLocalDate(date);
  d.setMinutes(minute);
  return d;
}
