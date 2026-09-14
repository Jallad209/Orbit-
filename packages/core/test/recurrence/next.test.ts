import { describe, expect, it } from 'vitest';
import {
  expandRecurrence,
  nextOccurrence,
  occurrenceAt,
  weeklyDays,
} from '../../src/recurrence/expand';
import type { Recurrence } from '../../src/schema';

const base: Recurrence = {
  freq: 'weekly',
  interval: 1,
  byDay: [],
  byMonthDay: null,
  count: null,
  until: null,
};

describe('weekly ordering (shared correctness fix)', () => {
  it('orders a Sunday and a Monday chronologically inside the Monday-based week', () => {
    // Anchor Monday 7 Sep; Sunday 13 Sep comes before Monday 14 Sep in calendar order.
    const r: Recurrence = { ...base, byDay: ['SU', 'MO'] };
    expect(expandRecurrence(r, '2026-09-07', { from: '2026-09-13', to: '2026-09-14' })).toEqual([
      '2026-09-13',
      '2026-09-14',
    ]);
    // The narrow range that used to miss the Monday: Sunday was checked first and stopped the walk.
    expect(expandRecurrence(r, '2026-09-07', { from: '2026-09-14', to: '2026-09-14' })).toEqual([
      '2026-09-14',
    ]);
    expect(weeklyDays(r, '2026-09-07')).toEqual(['MO', 'SU']);
  });

  it('does not let duplicate weekdays consume COUNT twice', () => {
    const r: Recurrence = { ...base, byDay: ['MO', 'MO', 'WE'], count: 3 };
    expect(expandRecurrence(r, '2026-09-07', { from: '2026-09-01', to: '2026-09-30' })).toEqual([
      '2026-09-07',
      '2026-09-09',
      '2026-09-14',
    ]);
  });

  it('keeps routine expansion unchanged for the ordinary weekday case', () => {
    const r: Recurrence = { ...base, byDay: ['FR', 'MO', 'WE'] };
    expect(expandRecurrence(r, '2026-09-09', { from: '2026-09-07', to: '2026-09-18' })).toEqual([
      '2026-09-09',
      '2026-09-11',
      '2026-09-14',
      '2026-09-16',
      '2026-09-18',
    ]);
  });
});

describe('nextOccurrence', () => {
  const monthly: Recurrence = { ...base, freq: 'monthly' };

  it('monthly on the 31st clamps February and returns to the 31st in March', () => {
    expect(nextOccurrence(monthly, '2026-01-31', 0)).toEqual({
      kind: 'next',
      date: '2026-02-28',
      index: 1,
    });
    expect(nextOccurrence(monthly, '2026-01-31', 1)).toEqual({
      kind: 'next',
      date: '2026-03-31',
      index: 2,
    });
    // A leap year keeps the 29th.
    expect(nextOccurrence(monthly, '2028-01-31', 0)).toMatchObject({ date: '2028-02-29' });
  });

  it('a monthly interval greater than one keeps the original anchor day', () => {
    const r = { ...monthly, interval: 3 };
    expect(nextOccurrence(r, '2026-01-31', 0)).toMatchObject({ date: '2026-04-30', index: 1 });
    expect(nextOccurrence(r, '2026-01-31', 1)).toMatchObject({ date: '2026-07-31', index: 2 });
  });

  it('COUNT is measured from the rule: COUNT=1 allows position zero only', () => {
    expect(nextOccurrence({ ...monthly, count: 1 }, '2026-01-31', 0)).toEqual({
      kind: 'exhausted',
      reason: 'count',
    });
    expect(nextOccurrence({ ...monthly, count: 2 }, '2026-01-31', 0)).toMatchObject({
      kind: 'next',
      index: 1,
    });
    expect(nextOccurrence({ ...monthly, count: 2 }, '2026-01-31', 1)).toEqual({
      kind: 'exhausted',
      reason: 'count',
    });
  });

  it('UNTIL is inclusive', () => {
    expect(nextOccurrence({ ...monthly, until: '2026-02-28' }, '2026-01-31', 0)).toMatchObject({
      kind: 'next',
      date: '2026-02-28',
    });
    expect(nextOccurrence({ ...monthly, until: '2026-02-27' }, '2026-01-31', 0)).toEqual({
      kind: 'exhausted',
      reason: 'until',
    });
  });

  it('weekly with a Sunday and a Monday returns the correct next chronological date', () => {
    const r: Recurrence = { ...base, byDay: ['SU', 'MO'] };
    expect(nextOccurrence(r, '2026-09-07', 0)).toMatchObject({ date: '2026-09-13', index: 1 });
    expect(nextOccurrence(r, '2026-09-07', 1)).toMatchObject({ date: '2026-09-14', index: 2 });
  });

  it('is bounded and reports a rule that leaves the calendar as invalid, not finished', () => {
    expect(
      nextOccurrence({ ...base, freq: 'daily', interval: 1_000_000 }, '2026-01-01', 5),
    ).toEqual({
      kind: 'invalid',
      message: 'This schedule runs past the year 9999.',
    });
    expect(nextOccurrence({ ...monthly, interval: 200_000 }, '2026-01-01', 0)).toMatchObject({
      kind: 'invalid',
    });
    expect(nextOccurrence(monthly, '2026-01-01', -1)).toMatchObject({ kind: 'invalid' });
    expect(nextOccurrence(monthly, '2026-13-01', 0)).toMatchObject({ kind: 'invalid' });
    expect(nextOccurrence({ ...monthly, interval: 0 }, '2026-01-01', 0)).toMatchObject({
      kind: 'invalid',
    });
  });

  it('occurrenceAt enumerates positions under COUNT and UNTIL', () => {
    expect(occurrenceAt({ ...monthly, count: 2 }, '2026-01-31', 0)).toBe('2026-01-31');
    expect(occurrenceAt({ ...monthly, count: 2 }, '2026-01-31', 1)).toBe('2026-02-28');
    expect(occurrenceAt({ ...monthly, count: 2 }, '2026-01-31', 2)).toBeNull();
    expect(occurrenceAt({ ...monthly, until: '2026-02-01' }, '2026-01-31', 1)).toBeNull();
  });
});
