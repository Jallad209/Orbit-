import type { Clock } from '../clock';
import { addDays, toInstant, toLocalDate } from '../dates';
import { createRecord } from '../records';
import { ReminderSchema } from '../schema';
import type { Bill, Commitment, Id, Instant, LocalDate, Person, Reminder, Rule } from '../schema';

/**
 * Reminder rules turn bills and unanswered commitments into queued
 * notifications. `computeReminders` says which reminders should exist right
 * now; `reconcileReminders` says which of those are new. The key names the
 * thing being reminded about (rule, entity, due date), never the fire time,
 * so re-evaluating every minute cannot queue duplicates, and a dismissed
 * reminder stays dismissed.
 */

/** Reminders fire at 09:00 local on the day they become relevant. */
export const REMINDER_HOUR_MIN = 9 * 60;

const DAY_MS = 86_400_000;

export interface ReminderDraft {
  key: string;
  ruleId: Id;
  entityType: 'bill' | 'commitment';
  entityId: Id;
  fireAt: Instant;
  title: string;
  body: string;
}

export interface ReminderSnapshot {
  rules: readonly Rule[];
  bills?: readonly Bill[];
  commitments?: readonly Commitment[];
  people?: readonly Person[];
}

export function reminderRules(rules: readonly Rule[]) {
  return rules.filter(
    (r): r is Extract<Rule, { type: 'reminder' }> =>
      r.deletedAt === null && r.enabled && r.type === 'reminder',
  );
}

export function reminderKey(ruleId: Id, entityId: Id, dueDate: LocalDate): string {
  return `${ruleId}:${entityId}:${dueDate}`;
}

function fireOn(date: LocalDate): Instant {
  return toInstant(date, REMINDER_HOUR_MIN).toISOString();
}

function daysWord(n: number): string {
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} overdue`;
  if (n === 0) return 'due today';
  if (n === 1) return 'due tomorrow';
  return `due in ${n} days`;
}

function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/**
 * Every reminder the enabled rules call for at `now`:
 * - `billDueWithin(days)`: each unpaid bill due on or before today + days
 *   (overdue ones included), firing at 09:00 the day it entered the window;
 * - `followUpAfter(days)`: each open commitment owed to me whose person has
 *   not been heard from in `days`, firing at 09:00 the day the window ran out.
 */
export function computeReminders(snapshot: ReminderSnapshot, now: Date): ReminderDraft[] {
  const today = toLocalDate(now);
  const out: ReminderDraft[] = [];
  const personById = new Map((snapshot.people ?? []).map((p) => [p.id, p]));

  for (const rule of reminderRules(snapshot.rules)) {
    const c = rule.config;
    if (c.kind === 'billDueWithin') {
      const limit = addDays(today, c.days);
      for (const bill of snapshot.bills ?? []) {
        if (bill.deletedAt !== null || bill.paid || bill.dueAt > limit) continue;
        // The day it entered the window is never after today (dueAt ≤ today + days);
        // a bill found late fires as soon as the scheduler sees it.
        const enters = addDays(bill.dueAt, -c.days);
        const amount = bill.amount
          ? ` · ${bill.amount}${bill.currency ? ` ${bill.currency}` : ''}`
          : '';
        out.push({
          key: reminderKey(rule.id, bill.id, bill.dueAt),
          ruleId: rule.id,
          entityType: 'bill',
          entityId: bill.id,
          fireAt: fireOn(enters),
          title: `${bill.title} ${daysWord(daysBetween(today, bill.dueAt))}`,
          body: `Due ${bill.dueAt}${amount}`,
        });
      }
    } else {
      for (const commitment of snapshot.commitments ?? []) {
        if (
          commitment.deletedAt !== null ||
          commitment.status !== 'open' ||
          commitment.direction !== 'owed-to-me'
        ) {
          continue;
        }
        const person = personById.get(commitment.personId);
        const lastContact = person?.lastContactAt ?? commitment.createdAt;
        const since = toLocalDate(new Date(lastContact));
        const expires = addDays(since, c.days);
        if (expires > today) continue;
        const quiet = daysBetween(since, today);
        out.push({
          key: reminderKey(rule.id, commitment.id, expires),
          ruleId: rule.id,
          entityType: 'commitment',
          entityId: commitment.id,
          fireAt: fireOn(expires),
          title: `Follow up${person ? ` with ${person.name}` : ''}`,
          body: `No reply on “${commitment.text}” for ${quiet} day${quiet === 1 ? '' : 's'}`,
        });
      }
    }
  }
  return out;
}

/**
 * The drafts that do not exist yet, by key. Existing rows count whatever
 * their status: a fired or dismissed reminder is never queued again.
 */
export function reconcileReminders(
  existing: readonly Reminder[],
  computed: readonly ReminderDraft[],
): ReminderDraft[] {
  const have = new Set(existing.map((r) => r.key));
  const out: ReminderDraft[] = [];
  for (const d of computed) {
    if (have.has(d.key)) continue;
    have.add(d.key);
    out.push(d);
  }
  return out;
}

/** Stamp drafts into records ready to store. */
export function toReminderRecords(drafts: readonly ReminderDraft[], clock: Clock): Reminder[] {
  return drafts.map((d) => createRecord(ReminderSchema, clock, { ...d, status: 'pending' }));
}

/** Pending reminders whose time has come. */
export function dueReminders(reminders: readonly Reminder[], now: Date): Reminder[] {
  const at = now.toISOString();
  return reminders
    .filter((r) => r.deletedAt === null && r.status === 'pending' && r.fireAt <= at)
    .sort((a, b) => (a.fireAt < b.fireAt ? -1 : a.fireAt > b.fireAt ? 1 : 0));
}
