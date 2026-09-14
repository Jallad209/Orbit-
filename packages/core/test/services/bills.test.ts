import { describe, expect, it } from 'vitest';
import { normalizeBill } from '../../src/schema/compat';
import { BillSchema } from '../../src/schema';
import type { Bill, Recurrence } from '../../src/schema';
import {
  BillError,
  advanceLegacy,
  billGroup,
  describeRecurrence,
  editBill,
  groupBills,
  isLatestUnpaid,
  payBill,
  previewSchedule,
  seriesOf,
  stopRepeating,
  successorPlan,
  totalsByCurrency,
  unpayBill,
  validateBillFields,
} from '../../src/services/bills';
import { aBill, testClock } from '../builders';

const clock = testClock(); // Sat 12 Sep 2026
const monthly: Recurrence = {
  freq: 'monthly',
  interval: 1,
  byDay: [],
  byMonthDay: null,
  count: null,
  until: null,
};

function recurring(overrides: Partial<Bill> = {}): Bill {
  const root = aBill({ title: 'Rent', amount: 900, currency: 'USD', dueAt: '2026-01-31' }, clock);
  return BillSchema.parse({
    ...root,
    recurrence: monthly,
    seriesId: root.id,
    recurrenceAnchor: '2026-01-31',
    scheduledFor: '2026-01-31',
    occurrenceIndex: 0,
    ...overrides,
  });
}

describe('bill groups and totals', () => {
  it('uses the fixed three-date due-soon rule with exact endpoints', () => {
    const today = '2026-09-12';
    expect(billGroup(aBill({ dueAt: '2026-09-11' }, clock), today)).toBe('overdue');
    expect(billGroup(aBill({ dueAt: '2026-09-12' }, clock), today)).toBe('due-soon');
    expect(billGroup(aBill({ dueAt: '2026-09-15' }, clock), today)).toBe('due-soon');
    expect(billGroup(aBill({ dueAt: '2026-09-16' }, clock), today)).toBe('upcoming');
    expect(billGroup(aBill({ dueAt: '2026-09-01', paid: true }, clock), today)).toBe('paid');
    expect(
      billGroup(
        { ...aBill({ dueAt: '2026-09-01' }, clock), deletedAt: clock.now().toISOString() },
        today,
      ),
    ).toBe('deleted');
    // Midnight rollover: the same bill moves from due-soon to overdue.
    const bill = aBill({ dueAt: '2026-09-12' }, clock);
    expect(billGroup(bill, '2026-09-13')).toBe('overdue');
  });

  it('groups with a stable order and keeps paid history newest first', () => {
    const a = aBill({ dueAt: '2026-09-20' }, clock);
    const b = aBill({ dueAt: '2026-09-20' }, clock);
    const paidOld = aBill(
      { dueAt: '2026-08-01', paid: true, paidAt: '2026-08-01T10:00:00.000Z' },
      clock,
    );
    const paidNew = aBill(
      { dueAt: '2026-08-15', paid: true, paidAt: '2026-08-16T10:00:00.000Z' },
      clock,
    );
    const legacy = aBill({ dueAt: '2026-07-01', paid: true }, clock);
    const groups = groupBills([b, a, paidOld, legacy, paidNew], '2026-09-12');
    expect(groups.upcoming.map((x) => x.id)).toEqual([a.id, b.id].sort());
    expect(groups.paid.map((x) => x.id)).toEqual([paidNew.id, paidOld.id, legacy.id]);
  });

  it('never adds two currencies into one number and keeps an unset currency separate', () => {
    expect(
      totalsByCurrency([
        aBill({ amount: 10, currency: 'USD' }, clock),
        aBill({ amount: 5.5, currency: 'JOD' }, clock),
        aBill({ amount: 0, currency: '' }, clock),
        aBill({ amount: 2.25, currency: 'USD' }, clock),
      ]),
    ).toEqual([
      { currency: '', total: 0 },
      { currency: 'JOD', total: 5.5 },
      { currency: 'USD', total: 12.25 },
    ]);
  });
});

describe('field validation and previews', () => {
  it('requires the first date to agree with the rule and rejects extreme intervals', () => {
    expect(validateBillFields({ title: '', amount: -1, dueAt: 'nope', recurrence: null })).toEqual({
      title: 'A title is required.',
      amount: 'Enter an amount of zero or more.',
      dueAt: 'Enter a real date.',
    });
    // 12 Sep 2026 is a Saturday.
    expect(
      validateBillFields({
        title: 'Gym',
        amount: 30,
        dueAt: '2026-09-12',
        recurrence: { ...monthly, freq: 'weekly', byDay: ['MO'] },
      }).recurrence,
    ).toMatch(/Saturday|Sat/);
    expect(
      validateBillFields({
        title: 'Rent',
        amount: 900,
        dueAt: '2026-09-12',
        recurrence: { ...monthly, byMonthDay: 1 },
      }).recurrence,
    ).toMatch(/1st/);
    expect(
      validateBillFields({
        title: 'Rent',
        amount: 900,
        dueAt: '2026-09-12',
        recurrence: { ...monthly, interval: 5000 },
      }).recurrence,
    ).toMatch(/between 1 and 1000/);
    expect(
      validateBillFields({
        title: 'Rent',
        amount: 900,
        dueAt: '2026-09-12',
        recurrence: { ...monthly, until: '2026-09-01' },
      }).recurrence,
    ).toMatch(/end date/);
    expect(
      validateBillFields({ title: 'Rent', amount: 900, dueAt: '2026-09-12', recurrence: monthly }),
    ).toEqual({});
  });

  it('previews the first occurrence and the next two, and describes the rule', () => {
    expect(previewSchedule(monthly, '2026-01-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
    expect(previewSchedule({ ...monthly, count: 2 }, '2026-01-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
    ]);
    expect(describeRecurrence(null)).toBe('One-off');
    expect(describeRecurrence({ ...monthly, byMonthDay: 31, count: 12 })).toBe(
      'Monthly on the 31st, 12 times',
    );
    expect(
      describeRecurrence({
        ...monthly,
        freq: 'weekly',
        interval: 2,
        byDay: ['TH', 'MO'],
        until: '2027-01-01',
      }),
    ).toBe('Every 2 weeks on Mon, Thu until 2027-01-01');
    expect(describeRecurrence({ ...monthly, freq: 'daily' })).toBe('Daily');
  });
});

describe('payBill', () => {
  it('keeps the paid row and generates exactly one successor from the original schedule', () => {
    const bill = recurring();
    const { paid, successor, plan } = payBill(bill, '2026-02-02T10:00:00.000Z', clock);
    expect(plan).toEqual({ kind: 'next', date: '2026-02-28', index: 1 });
    expect(paid).toMatchObject({
      id: bill.id,
      paid: true,
      paidAt: '2026-02-02T10:00:00.000Z',
      dueAt: '2026-01-31',
      amount: 900,
      nextBillId: successor!.id,
    });
    expect(successor).toMatchObject({
      title: 'Rent',
      amount: 900,
      currency: 'USD',
      dueAt: '2026-02-28',
      scheduledFor: '2026-02-28',
      occurrenceIndex: 1,
      seriesId: bill.id,
      recurrenceAnchor: '2026-01-31',
      paid: false,
      repeatStopped: false,
      nextBillId: null,
    });
    expect(successor!.id).not.toBe(bill.id);
    // Paying the successor continues from the anchor: back to the 31st in March.
    expect(payBill(successor!, '2026-03-01T10:00:00.000Z', clock).successor?.dueAt).toBe(
      '2026-03-31',
    );
  });

  it('finds the next date from the scheduled date, not the payment time or an edited deadline', () => {
    const late = recurring();
    // Paid three months late: the next occurrence is February, already overdue, not May.
    const result = payBill(late, '2026-05-15T10:00:00.000Z', clock);
    expect(result.successor?.scheduledFor).toBe('2026-02-28');
    const edited = editBill(recurring(), { dueAt: '2026-02-10' });
    expect(edited).toMatchObject({ dueAt: '2026-02-10', scheduledFor: '2026-01-31' });
    expect(payBill(edited, '2026-02-10T10:00:00.000Z', clock).successor?.dueAt).toBe('2026-02-28');
  });

  it('a one-off, an exhausted rule, and a stopped occurrence generate nothing', () => {
    expect(payBill(aBill({}, clock), '2026-09-12T10:00:00.000Z', clock)).toMatchObject({
      successor: null,
      plan: { kind: 'one-off' },
    });
    const last = recurring({ recurrence: { ...monthly, count: 1 } });
    expect(payBill(last, '2026-02-01T10:00:00.000Z', clock)).toMatchObject({
      successor: null,
      plan: { kind: 'finished', reason: 'count' },
    });
    const stopped = stopRepeating(recurring());
    expect(stopped.repeatStopped).toBe(true);
    expect(stopped.recurrence).toEqual(monthly);
    expect(payBill(stopped, '2026-02-01T10:00:00.000Z', clock)).toMatchObject({
      successor: null,
      plan: { kind: 'stopped' },
    });
  });

  it('refuses a deleted, already-paid, or badly timed payment', () => {
    const bill = recurring();
    expect(() => payBill({ ...bill, paid: true }, '2026-02-01T10:00:00.000Z', clock)).toThrow(
      BillError,
    );
    expect(() =>
      payBill(
        { ...bill, deletedAt: '2026-02-01T10:00:00.000Z' },
        '2026-02-01T10:00:00.000Z',
        clock,
      ),
    ).toThrow(/deleted/);
    expect(() => payBill(bill, 'not a time', clock)).toThrow(/valid instant/);
  });
});

describe('corrections, stopping, and legacy recovery', () => {
  it('unpay is a one-off correction only; a payment with a successor stays paid', () => {
    const one = aBill({ paid: true, paidAt: '2026-09-01T10:00:00.000Z' }, clock);
    expect(unpayBill(one)).toMatchObject({ paid: false, paidAt: null });
    const { paid } = payBill(recurring(), '2026-02-01T10:00:00.000Z', clock);
    expect(() => unpayBill(paid)).toThrow(/next occurrence/);
    expect(() => unpayBill(aBill({}, clock))).toThrow(/not paid/);
  });

  it('only the latest unpaid occurrence can stop the series', () => {
    const { paid, successor } = payBill(recurring(), '2026-02-01T10:00:00.000Z', clock);
    expect(() => stopRepeating(paid)).toThrow(/latest unpaid/);
    expect(stopRepeating(successor!).repeatStopped).toBe(true);
    expect(() => stopRepeating(aBill({}, clock))).toThrow(/does not repeat/);
    expect(isLatestUnpaid(successor!, [paid, successor!])).toBe(true);
    expect(isLatestUnpaid(paid, [paid, successor!])).toBe(false);
  });

  it('a legacy paid row is never advanced automatically, only by the explicit action', () => {
    const legacyRaw = {
      ...aBill({ title: 'Gym', dueAt: '2026-08-03', paid: true }, clock),
      recurrence: { ...monthly, freq: 'weekly' as const },
    };
    const { record, repairs } = normalizeBill(legacyRaw);
    expect(repairs).toEqual([]);
    expect(record).toMatchObject({
      seriesId: legacyRaw.id,
      recurrenceAnchor: '2026-08-03',
      scheduledFor: '2026-08-03',
      occurrenceIndex: 0,
      paidAt: null,
      nextBillId: null,
    });
    expect(successorPlan(record)).toEqual({ kind: 'next', date: '2026-08-10', index: 1 });
    const advanced = advanceLegacy(record, clock);
    expect(advanced.successor).toMatchObject({ dueAt: '2026-08-10', occurrenceIndex: 1 });
    expect(advanced.paid.nextBillId).toBe(advanced.successor!.id);
    expect(() => advanceLegacy(advanced.paid, clock)).toThrow(/already has a successor/);
    expect(() => advanceLegacy(aBill({}, clock), clock)).toThrow(/paid occurrence/);
  });

  it('normalizes malformed lineage back to a consistent root and reports it', () => {
    const raw = {
      ...aBill({ dueAt: '2026-09-01' }, clock),
      recurrence: monthly,
      seriesId: 'not-a-uuid',
      occurrenceIndex: -3,
      nextBillId: 'garbage',
    };
    const { record, repairs } = normalizeBill(raw);
    expect(repairs).toEqual(expect.arrayContaining(['seriesId', 'occurrenceIndex', 'nextBillId']));
    expect(record).toMatchObject({ seriesId: raw.id, occurrenceIndex: 0, nextBillId: null });
    expect(() => normalizeBill({ ...raw, amount: 'lots' })).toThrow(/invalid/);
    expect(() => normalizeBill(null)).toThrow(/not an object/);
    // A one-off bill needs no lineage and passes untouched.
    const plain = aBill({}, clock);
    expect(normalizeBill(plain).record).toEqual(plain);
  });

  it('seriesOf orders a chain by position', () => {
    const first = payBill(recurring(), '2026-02-01T10:00:00.000Z', clock);
    const second = payBill(first.successor!, '2026-03-01T10:00:00.000Z', clock);
    const rows = [second.successor!, first.paid, second.paid];
    expect(seriesOf(rows, first.paid.seriesId!).map((b) => b.occurrenceIndex)).toEqual([0, 1, 2]);
  });
});
