import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareLocalDates,
  dayOfWeek,
  daysInMonth,
  formatMinute,
  fromLocalDate,
  isValidLocalDate,
  minuteOfDay,
  parseMinute,
  toInstant,
  toLocalDate,
} from '../src/dates';
import { fixedClock, nowIso, systemClock } from '../src/clock';

describe('local dates', () => {
  it('validates real calendar dates', () => {
    expect(isValidLocalDate('2026-09-12')).toBe(true);
    expect(isValidLocalDate('2024-02-29')).toBe(true);
    expect(isValidLocalDate('2026-02-29')).toBe(false);
    expect(isValidLocalDate('2026-13-01')).toBe(false);
    expect(isValidLocalDate('2026-9-1')).toBe(false);
  });

  it('round-trips through Date at local midnight', () => {
    const d = fromLocalDate('2026-09-12');
    expect(d.getHours()).toBe(0);
    expect(toLocalDate(d)).toBe('2026-09-12');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('reports day of week', () => {
    expect(dayOfWeek('2026-09-12')).toBe(6); // Saturday
    expect(dayOfWeek('2026-09-14')).toBe(1); // Monday
  });

  it('compares calendar dates lexically', () => {
    expect(compareLocalDates('2026-09-12', '2026-09-13')).toBe(-1);
    expect(compareLocalDates('2026-09-13', '2026-09-12')).toBe(1);
    expect(compareLocalDates('2026-09-12', '2026-09-12')).toBe(0);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it('throws on an unparseable local date', () => {
    expect(() => fromLocalDate('nope')).toThrow(/invalid local date/);
  });
});

describe('minutes of day', () => {
  it('formats and parses HH:MM', () => {
    expect(formatMinute(0)).toBe('00:00');
    expect(formatMinute(9 * 60 + 5)).toBe('09:05');
    expect(formatMinute(1440)).toBe('24:00');
    expect(parseMinute('19:00')).toBe(19 * 60);
    expect(parseMinute('7:30')).toBe(7 * 60 + 30);
    expect(() => parseMinute('25:00')).toThrow();
    expect(() => parseMinute('abc')).toThrow();
  });

  it('extracts minute-of-day and rebuilds an instant', () => {
    const at = toInstant('2026-09-12', 14 * 60 + 15);
    expect(minuteOfDay(at)).toBe(14 * 60 + 15);
    expect(toLocalDate(at)).toBe('2026-09-12');
  });
});

describe('systemClock', () => {
  it('tracks wall time and renders ISO instants', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(nowIso(systemClock)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('fixedClock', () => {
  it('is deterministic and advanceable', () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-09-12T09:00:00.000Z');
    clock.advance(60_000);
    expect(clock.now().toISOString()).toBe('2026-09-12T09:01:00.000Z');
    clock.set('2027-01-01T00:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});
