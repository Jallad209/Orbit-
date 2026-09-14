import type { Clock } from '../clock';
import { nowIso } from '../clock';
import { addDays, dayOfWeek, fromLocalDate, isValidLocalDate } from '../dates';
import { newId } from '../ids';
import { createRecord } from '../records';
import { nextOccurrence, occurrenceAt, weeklyDays } from '../recurrence/expand';
import { BillSchema } from '../schema';
import type { Bill, Id, Instant, LocalDate, Recurrence, Weekday } from '../schema';

/**
 * Bills as occurrences of a schedule (week 12). Pure: every function here
 * works over records and an injected clock; the application service owns
 * the transaction that re-reads the current row, applies one of these
 * transitions, and writes the result together with its reminder rows and,
 * inside a weekly review, its receipt.
 */

/** "Due soon" is a fixed product rule: today through today + 3 local dates, inclusive. */
export const DUE_SOON_DAYS = 3;

export type BillGroup = 'overdue' | 'due-soon' | 'upcoming' | 'paid' | 'deleted';

/** Which list a bill belongs in on `today`. Paid and deleted are never "due". */
export function billGroup(bill: Bill, today: LocalDate): BillGroup {
  if (bill.deletedAt !== null) return 'deleted';
  if (bill.paid) return 'paid';
  if (bill.dueAt < today) return 'overdue';
  if (bill.dueAt <= addDays(today, DUE_SOON_DAYS)) return 'due-soon';
  return 'upcoming';
}

/** Due date first, then id, so identical dates keep a stable order. */
export function compareBills(a: Bill, b: Bill): number {
  return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface BillGroups {
  overdue: Bill[];
  dueSoon: Bill[];
  upcoming: Bill[];
  /** Newest payment first: paid time, then due date, descending. */
  paid: Bill[];
  deleted: Bill[];
}

export function groupBills(bills: readonly Bill[], today: LocalDate): BillGroups {
  const groups: BillGroups = { overdue: [], dueSoon: [], upcoming: [], paid: [], deleted: [] };
  for (const bill of bills) {
    const g = billGroup(bill, today);
    if (g === 'overdue') groups.overdue.push(bill);
    else if (g === 'due-soon') groups.dueSoon.push(bill);
    else if (g === 'upcoming') groups.upcoming.push(bill);
    else if (g === 'paid') groups.paid.push(bill);
    else groups.deleted.push(bill);
  }
  groups.overdue.sort(compareBills);
  groups.dueSoon.sort(compareBills);
  groups.upcoming.sort(compareBills);
  groups.deleted.sort(compareBills);
  groups.paid.sort((a, b) => {
    const pa = a.paidAt ?? '';
    const pb = b.paidAt ?? '';
    if (pa !== pb) return pa < pb ? 1 : -1;
    return -compareBills(a, b);
  });
  return groups;
}

/** Sums per currency; an empty currency is its own group ("currency not set"), never merged. */
export function totalsByCurrency(
  bills: readonly Bill[],
): Array<{ currency: string; total: number }> {
  const sums = new Map<string, number>();
  for (const b of bills) sums.set(b.currency, (sums.get(b.currency) ?? 0) + b.amount);
  return [...sums.entries()]
    .map(([currency, total]) => ({ currency, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

const WEEKDAY_LABEL: Record<Weekday, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
};

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** A sentence for the schedule: "Monthly on the 31st, 12 times", "Every 2 weeks on Mon, Thu until 2027-01-01". */
export function describeRecurrence(
  recurrence: Recurrence | null,
  anchor?: LocalDate | null,
): string {
  if (!recurrence) return 'One-off';
  const n = Math.max(1, recurrence.interval);
  let head: string;
  if (recurrence.freq === 'daily') head = n === 1 ? 'Daily' : `Every ${n} days`;
  else if (recurrence.freq === 'weekly') {
    const days = recurrence.byDay.length
      ? weeklyDays(recurrence, anchor ?? '2026-01-05')
          .map((d) => WEEKDAY_LABEL[d])
          .join(', ')
      : anchor
        ? WEEKDAY_LABEL[(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const)[dayOfWeek(anchor)]!]
        : '';
    head = `${n === 1 ? 'Weekly' : `Every ${n} weeks`}${days ? ` on ${days}` : ''}`;
  } else {
    const day = recurrence.byMonthDay ?? (anchor ? fromLocalDate(anchor).getDate() : null);
    head = `${n === 1 ? 'Monthly' : `Every ${n} months`}${day ? ` on the ${ordinal(day)}` : ''}`;
  }
  const count =
    recurrence.count !== null
      ? `, ${recurrence.count} time${recurrence.count === 1 ? '' : 's'}`
      : '';
  const until = recurrence.until !== null ? ` until ${recurrence.until}` : '';
  return `${head}${count}${until}`;
}

export interface BillFieldErrors {
  title?: string;
  amount?: string;
  dueAt?: string;
  recurrence?: string;
}

/**
 * Field validation for a new or edited bill. The first scheduled date must
 * agree with the rule (a weekly rule on Mondays cannot start on a Tuesday;
 * a monthly rule on the 15th cannot start on the 3rd) — the form asks the
 * user to adjust one or the other rather than silently moving either.
 */
export function validateBillFields(fields: {
  title: string;
  amount: number;
  dueAt: string;
  recurrence: Recurrence | null;
}): BillFieldErrors {
  const errors: BillFieldErrors = {};
  if (!fields.title.trim()) errors.title = 'A title is required.';
  if (!Number.isFinite(fields.amount) || fields.amount < 0)
    errors.amount = 'Enter an amount of zero or more.';
  if (!isValidLocalDate(fields.dueAt)) errors.dueAt = 'Enter a real date.';
  const r = fields.recurrence;
  if (r && isValidLocalDate(fields.dueAt)) {
    if (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > 1000)
      errors.recurrence = 'The interval must be between 1 and 1000.';
    else if (r.freq === 'weekly' && r.byDay.length) {
      const first = (['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const)[dayOfWeek(fields.dueAt)]!;
      if (!r.byDay.includes(first))
        errors.recurrence = `The first date is a ${WEEKDAY_LABEL[first]}, which the weekly rule does not include. Change the date or the days.`;
    } else if (r.freq === 'monthly' && r.byMonthDay !== null) {
      const day = fromLocalDate(fields.dueAt).getDate();
      if (day !== r.byMonthDay)
        errors.recurrence = `The first date is the ${ordinal(day)}, but the rule repeats on the ${ordinal(r.byMonthDay)}. Change the date or the day.`;
    }
    if (!errors.recurrence && r.until !== null && r.until < fields.dueAt)
      errors.recurrence = 'The end date is before the first date.';
    if (!errors.recurrence) {
      const probe = nextOccurrence(r, fields.dueAt, 0);
      if (probe.kind === 'invalid') errors.recurrence = probe.message;
    }
  }
  return errors;
}

/** The first occurrence and the next two, for the creation preview. */
export function previewSchedule(recurrence: Recurrence, anchor: LocalDate, count = 3): LocalDate[] {
  const out: LocalDate[] = [];
  for (let i = 0; i < count; i++) {
    const date = occurrenceAt(recurrence, anchor, i);
    if (!date) break;
    out.push(date);
  }
  return out;
}

export type SuccessorPlan =
  | { kind: 'one-off' }
  | { kind: 'stopped' }
  | { kind: 'finished'; reason: 'count' | 'until' }
  | { kind: 'invalid'; message: string }
  | { kind: 'next'; date: LocalDate; index: number };

/**
 * What paying `bill` should generate: the next scheduled occurrence under
 * the original anchor and rule, found from this occurrence's scheduled
 * date and position — never from the payment time or an edited deadline.
 * A late payment still produces the next scheduled date, even one already
 * in the past; missed installments are not skipped.
 */
export function successorPlan(bill: Bill): SuccessorPlan {
  if (bill.recurrence === null || bill.seriesId === null) return { kind: 'one-off' };
  if (bill.repeatStopped) return { kind: 'stopped' };
  const anchor = bill.recurrenceAnchor ?? bill.scheduledFor ?? bill.dueAt;
  const next = nextOccurrence(bill.recurrence, anchor, bill.occurrenceIndex);
  if (next.kind === 'exhausted') return { kind: 'finished', reason: next.reason };
  if (next.kind === 'invalid') return { kind: 'invalid', message: next.message };
  return next;
}

/** The successor record for `paid`, with the schedule carried and the money fields copied. */
export function buildSuccessor(
  paid: Bill,
  plan: Extract<SuccessorPlan, { kind: 'next' }>,
  clock: Clock,
): Bill {
  return createRecord(BillSchema, clock, {
    id: newId(),
    title: paid.title,
    amount: paid.amount,
    currency: paid.currency,
    dueAt: plan.date,
    recurrence: paid.recurrence,
    paid: false,
    seriesId: paid.seriesId,
    recurrenceAnchor: paid.recurrenceAnchor ?? paid.scheduledFor ?? paid.dueAt,
    occurrenceIndex: plan.index,
    scheduledFor: plan.date,
    paidAt: null,
    nextBillId: null,
    repeatStopped: false,
  });
}

export interface PaymentResult {
  paid: Bill;
  successor: Bill | null;
  plan: SuccessorPlan;
}

export class BillError extends Error {
  constructor(
    public readonly code:
      | 'already-paid'
      | 'not-paid'
      | 'deleted'
      | 'has-successor'
      | 'invalid-payment-time'
      | 'invalid-schedule'
      | 'not-latest'
      | 'not-recurring'
      | 'successor-exists',
    message: string,
  ) {
    super(message);
    this.name = 'BillError';
  }
}

/**
 * Pay one occurrence: the row keeps its identity, amount, due date, and
 * gets its payment time; at most one successor is generated from the
 * schedule. Throws when the bill is deleted or already paid — a repeated
 * payment is the caller's replay case, not a second successor.
 */
export function payBill(bill: Bill, paidAt: Instant, clock: Clock): PaymentResult {
  if (bill.deletedAt !== null) throw new BillError('deleted', 'This bill was deleted.');
  if (bill.paid) throw new BillError('already-paid', 'This bill is already paid.');
  if (!Number.isFinite(new Date(paidAt).getTime()))
    throw new BillError('invalid-payment-time', 'The payment time is not a valid instant.');
  const plan = successorPlan(bill);
  const paid: Bill = BillSchema.parse({ ...bill, paid: true, paidAt, updatedAt: nowIso(clock) });
  if (plan.kind === 'next') {
    const successor = buildSuccessor(paid, plan, clock);
    return { paid: { ...paid, nextBillId: successor.id }, successor, plan };
  }
  return { paid, successor: null, plan };
}

/**
 * Return a paid bill to unpaid (a one-off correction). Refused when a
 * successor was generated from the payment: reversing that is a grouped
 * operation this milestone does not offer.
 */
export function unpayBill(bill: Bill): Bill {
  if (bill.deletedAt !== null) throw new BillError('deleted', 'This bill was deleted.');
  if (!bill.paid) throw new BillError('not-paid', 'This bill is not paid.');
  if (bill.nextBillId !== null)
    throw new BillError(
      'has-successor',
      'This payment generated the next occurrence. Reversing it would leave the series inconsistent, so it stays paid; edit the next occurrence instead.',
    );
  return { ...bill, paid: false, paidAt: null };
}

/**
 * Stop the schedule at this occurrence. Only the latest unpaid occurrence
 * of a series (nothing has been generated after it) can stop it; the
 * recurrence description and paid history stay as they are.
 */
export function stopRepeating(bill: Bill): Bill {
  if (bill.deletedAt !== null) throw new BillError('deleted', 'This bill was deleted.');
  if (bill.recurrence === null || bill.seriesId === null)
    throw new BillError('not-recurring', 'This bill does not repeat.');
  if (bill.paid || bill.nextBillId !== null)
    throw new BillError('not-latest', 'Only the latest unpaid occurrence can stop the series.');
  return { ...bill, repeatStopped: true };
}

/**
 * A legacy paid recurring row (paid before successors were linked) may be
 * advanced explicitly: the same successor lookup as a payment, from the
 * assumed anchor the caller has shown the user. Never automatic.
 */
export function advanceLegacy(bill: Bill, clock: Clock): PaymentResult {
  if (bill.deletedAt !== null) throw new BillError('deleted', 'This bill was deleted.');
  if (!bill.paid) throw new BillError('not-paid', 'Only a paid occurrence can be advanced.');
  if (bill.nextBillId !== null)
    throw new BillError('successor-exists', 'This occurrence already has a successor.');
  const plan = successorPlan(bill);
  if (plan.kind === 'invalid') throw new BillError('invalid-schedule', plan.message);
  if (plan.kind !== 'next') return { paid: bill, successor: null, plan };
  const successor = buildSuccessor(bill, plan, clock);
  return { paid: { ...bill, nextBillId: successor.id }, successor, plan };
}

/** Field edits an unpaid occurrence accepts; the schedule is not among them. */
export type BillPatch = Partial<Pick<Bill, 'title' | 'amount' | 'currency' | 'dueAt'>>;

/**
 * Apply a field edit to an occurrence. A due-date edit moves only this
 * occurrence's deadline: `scheduledFor` and the anchor are untouched, so
 * later occurrences do not drift.
 */
export function editBill(bill: Bill, patch: BillPatch): Bill {
  if (bill.deletedAt !== null) throw new BillError('deleted', 'This bill was deleted.');
  return { ...bill, ...patch };
}

/** Occurrences of one series, oldest position first. */
export function seriesOf(bills: readonly Bill[], seriesId: Id): Bill[] {
  return bills
    .filter((b) => b.seriesId === seriesId)
    .sort((a, b) => a.occurrenceIndex - b.occurrenceIndex || compareBills(a, b));
}

/** Whether `bill` is the newest occurrence of its series that has not been paid. */
export function isLatestUnpaid(bill: Bill, bills: readonly Bill[]): boolean {
  if (bill.paid || bill.deletedAt !== null || bill.seriesId === null) return false;
  return !bills.some(
    (b) =>
      b.id !== bill.id &&
      b.seriesId === bill.seriesId &&
      b.deletedAt === null &&
      b.occurrenceIndex > bill.occurrenceIndex,
  );
}
