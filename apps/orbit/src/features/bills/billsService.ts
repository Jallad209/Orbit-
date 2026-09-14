import {
  BillError,
  BillSchema,
  advanceLegacy as advanceLegacyRule,
  createRecord,
  editBill as editBillRule,
  groupBills,
  isLatestUnpaid,
  newId,
  payBill as payBillRule,
  seriesOf,
  stopRepeating as stopRepeatingRule,
  successorPlan,
  systemClock,
  toLocalDate,
  totalsByCurrency,
  unpayBill as unpayBillRule,
  validateBillFields,
} from '@orbit/core';
import type {
  Bill,
  BillGroups,
  BillPatch,
  Clock,
  Id,
  Instant,
  LocalDate,
  Recurrence,
  Reminder,
  SuccessorPlan,
} from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { ConflictError, currentRecord, mergePatch, mutate } from '@/data/mutations';
import { reconcileReminderQueue } from '@/features/reminders/reminderService';

/**
 * Bills (week 12). Every mutation re-reads the current occurrence inside
 * its transaction, applies one of the core rules, reconciles the reminder
 * queue, and lets an enclosing weekly review append its receipt through
 * `within` before the commit. A payment is one atomic operation: the paid
 * row, at most one successor, the reminder changes, and the receipt
 * either all land or none do.
 */

export interface BillsView {
  today: LocalDate;
  groups: BillGroups;
  /** Per group, the sums per currency (never added across currencies). */
  totals: Record<keyof BillGroups, Array<{ currency: string; total: number }>>;
  /** Pending reminder per bill id, when a bill rule is enabled. */
  reminders: Map<Id, Reminder>;
}

export async function loadBills(repo: Repository, clock: Clock = systemClock): Promise<BillsView> {
  const today = toLocalDate(clock.now());
  const [bills, reminders] = await Promise.all([
    repo.bills.list({ includeDeleted: true }),
    repo.reminders.query((r) => r.entityType === 'bill' && r.status === 'pending'),
  ]);
  const groups = groupBills(bills, today);
  return {
    today,
    groups,
    totals: {
      overdue: totalsByCurrency(groups.overdue),
      dueSoon: totalsByCurrency(groups.dueSoon),
      upcoming: totalsByCurrency(groups.upcoming),
      paid: totalsByCurrency(groups.paid),
      deleted: totalsByCurrency(groups.deleted),
    },
    reminders: new Map(reminders.map((r) => [r.entityId, r])),
  };
}

export interface BillDetail {
  bill: Bill;
  /** Every occurrence of the series, oldest position first (the bill itself for a one-off). */
  series: Bill[];
  predecessor: Bill | null;
  successor: Bill | null;
  reminder: Reminder | null;
  latestUnpaid: boolean;
  plan: SuccessorPlan;
  /** A paid recurring row without a successor from before successors were linked. */
  legacyPaid: boolean;
}

export async function loadBill(repo: Repository, id: Id): Promise<BillDetail | null> {
  const bill = await repo.bills.get(id);
  if (!bill) return null;
  const [rows, reminders] = await Promise.all([
    bill.seriesId
      ? repo.bills.query((b) => b.seriesId === bill.seriesId, { includeDeleted: true })
      : Promise.resolve([bill]),
    repo.reminders.query(
      (r) => r.entityType === 'bill' && r.entityId === id && r.status === 'pending',
    ),
  ]);
  const series = bill.seriesId ? seriesOf(rows, bill.seriesId) : [bill];
  const predecessor = series.find((b) => b.nextBillId === bill.id) ?? null;
  const successor = bill.nextBillId ? ((await repo.bills.get(bill.nextBillId)) ?? null) : null;
  const plan = successorPlan(bill);
  return {
    bill,
    series,
    predecessor,
    successor,
    reminder: reminders[0] ?? null,
    latestUnpaid: isLatestUnpaid(
      bill,
      rows.filter((b) => b.deletedAt === null),
    ),
    plan,
    legacyPaid:
      bill.paid && bill.nextBillId === null && bill.recurrence !== null && plan.kind === 'next',
  };
}

export interface BillFields {
  title: string;
  amount: number;
  currency: string;
  dueAt: LocalDate;
  recurrence: Recurrence | null;
}

/** Field errors, or null when the fields are valid. */
export function billFieldErrors(fields: BillFields) {
  const errors = validateBillFields(fields);
  return Object.keys(errors).length ? errors : null;
}

/** A new one-off bill, or the root of a new series anchored at its first date. */
export async function createBill(
  repo: Repository,
  fields: BillFields,
  clock: Clock = systemClock,
): Promise<Bill> {
  const errors = billFieldErrors(fields);
  if (errors) throw new Error(Object.values(errors)[0]!);
  const id = newId();
  const bill = createRecord(BillSchema, clock, {
    id,
    title: fields.title.trim(),
    amount: fields.amount,
    currency: fields.currency.trim(),
    dueAt: fields.dueAt,
    recurrence: fields.recurrence,
    paid: false,
    seriesId: fields.recurrence ? id : null,
    recurrenceAnchor: fields.recurrence ? fields.dueAt : null,
    scheduledFor: fields.recurrence ? fields.dueAt : null,
    occurrenceIndex: 0,
  });
  return mutate(repo, async (tx) => {
    const saved = await tx.bills.upsert(bill);
    await reconcileReminderQueue(tx, clock);
    return saved;
  });
}

/**
 * Edit this occurrence's title, amount, currency, or deadline. The
 * schedule (anchor, position, scheduled date) never changes here, so a
 * moved deadline cannot drift later occurrences; a successor generated
 * later copies the edited money fields.
 */
export async function editBill(
  repo: Repository,
  base: Bill,
  patch: BillPatch,
  clock: Clock = systemClock,
): Promise<Bill> {
  return mutate(repo, async (tx) => {
    const current = await currentRecord(tx.bills, { id: base.id }, { noun: 'bill' });
    const merged = mergePatch<Bill>(current, base, patch);
    const errors = billFieldErrors({
      title: merged.title,
      amount: merged.amount,
      currency: merged.currency,
      dueAt: merged.dueAt,
      recurrence: null,
    });
    if (errors) throw new Error(Object.values(errors)[0]!);
    const next = await tx.bills.upsert(
      editBillRule(current, {
        title: merged.title.trim(),
        amount: merged.amount,
        currency: merged.currency.trim(),
        dueAt: merged.dueAt,
      }),
    );
    await reconcileReminderQueue(tx, clock);
    return next;
  });
}

export interface PaymentOutcome {
  paid: Bill;
  successor: Bill | null;
  plan: SuccessorPlan;
  /** The bill was already paid: nothing was repeated and the stored result is returned. */
  replayed: boolean;
}

export interface WithinOptions {
  /** Extra writes that must commit with the operation (a review receipt). */
  within?: (tx: Repository, outcome: PaymentOutcome) => Promise<void>;
  clock?: Clock;
}

/**
 * Mark paid, atomically and idempotently: an already-paid bill returns its
 * stored payment and successor without generating another occurrence; a
 * deleted bill is refused. The paid row keeps its identity and deadline,
 * at most one successor is created from the original schedule, obsolete
 * reminders are cancelled and the successor's prepared, and any receipt
 * writes join the same transaction.
 */
export async function payBill(
  repo: Repository,
  base: Pick<Bill, 'id'>,
  paidAt: Instant,
  options: WithinOptions = {},
): Promise<PaymentOutcome> {
  const clock = options.clock ?? systemClock;
  return mutate(repo, async (tx) => {
    const current = await currentRecord(tx.bills, { id: base.id }, { noun: 'bill' });
    let outcome: PaymentOutcome;
    if (current.paid) {
      const successor = current.nextBillId
        ? ((await tx.bills.get(current.nextBillId)) ?? null)
        : null;
      outcome = { paid: current, successor, plan: successorPlan(current), replayed: true };
    } else {
      const result = payBillRule(current, paidAt, clock);
      const paid = await tx.bills.upsert(result.paid);
      const successor = result.successor ? await tx.bills.upsert(result.successor) : null;
      await reconcileReminderQueue(tx, clock);
      outcome = { paid, successor, plan: result.plan, replayed: false };
    }
    if (options.within) await options.within(tx, outcome);
    return outcome;
  });
}

/** A one-off correction: back to unpaid with the payment time cleared. */
export async function unpayBill(
  repo: Repository,
  base: Pick<Bill, 'id'>,
  clock: Clock = systemClock,
): Promise<Bill> {
  return mutate(repo, async (tx) => {
    const current = await currentRecord(tx.bills, { id: base.id }, { noun: 'bill' });
    const next = await tx.bills.upsert(unpayBillRule(current));
    await reconcileReminderQueue(tx, clock);
    return next;
  });
}

/** Stop generation from this (latest unpaid) occurrence on; history and the rule text stay. */
export async function stopRepeating(
  repo: Repository,
  base: Pick<Bill, 'id'>,
  options: { within?: (tx: Repository, bill: Bill) => Promise<void>; clock?: Clock } = {},
): Promise<Bill> {
  return mutate(repo, async (tx) => {
    const current = await currentRecord(tx.bills, { id: base.id }, { noun: 'bill' });
    if (current.repeatStopped) return current;
    const rows = await tx.bills.query((b) => b.seriesId === current.seriesId);
    if (!isLatestUnpaid(current, rows))
      throw new BillError('not-latest', 'Only the latest unpaid occurrence can stop the series.');
    const next = await tx.bills.upsert(stopRepeatingRule(current));
    if (options.within) await options.within(tx, next);
    return next;
  });
}

/** The explicit recovery for a legacy paid row: one successor from the assumed anchor. */
export async function advanceLegacy(
  repo: Repository,
  base: Pick<Bill, 'id'>,
  clock: Clock = systemClock,
): Promise<PaymentOutcome> {
  return mutate(repo, async (tx) => {
    const current = await currentRecord(tx.bills, { id: base.id }, { noun: 'bill' });
    if (current.nextBillId) {
      const successor = (await tx.bills.get(current.nextBillId)) ?? null;
      return { paid: current, successor, plan: successorPlan(current), replayed: true };
    }
    const result = advanceLegacyRule(current, clock);
    if (!result.successor) return { ...result, replayed: false };
    const successor = await tx.bills.upsert(result.successor);
    const paid = await tx.bills.upsert(result.paid);
    await reconcileReminderQueue(tx, clock);
    return { paid, successor, plan: result.plan, replayed: false };
  });
}

/** What deleting this occurrence means, for the confirmation. */
export async function deletionNote(repo: Repository, bill: Bill): Promise<string> {
  if (bill.seriesId === null || bill.paid)
    return 'Only this bill is deleted; its history stays for recovery.';
  const rows = await repo.bills.query((b) => b.seriesId === bill.seriesId);
  if (isLatestUnpaid(bill, rows) && !bill.repeatStopped)
    return 'This is the latest unpaid occurrence: deleting it stops the series, because there is no payable occurrence left to generate the next one from. Paid history is untouched.';
  return 'Only this occurrence is deleted; the rest of the series is untouched.';
}

/** Soft-delete one occurrence; lineage and links stay for recovery. */
export async function deleteBill(
  repo: Repository,
  billId: Id,
  clock: Clock = systemClock,
): Promise<void> {
  await mutate(repo, async (tx) => {
    await currentRecord(tx.bills, { id: billId }, { noun: 'bill' });
    await tx.bills.softDelete(billId);
    await reconcileReminderQueue(tx, clock);
  });
}

/** Restore a deleted occurrence; reminders follow the usual deduplication, nothing is generated. */
export async function restoreBill(
  repo: Repository,
  billId: Id,
  clock: Clock = systemClock,
): Promise<Bill> {
  return mutate(repo, async (tx) => {
    const current = await currentRecord(
      tx.bills,
      { id: billId },
      { noun: 'bill', allowDeleted: true },
    );
    if (current.deletedAt === null) return current;
    const next = await tx.bills.upsert({ ...current, deletedAt: null });
    await reconcileReminderQueue(tx, clock);
    return next;
  });
}

export { BillError, ConflictError };
