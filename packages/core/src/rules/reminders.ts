import type { Clock } from '../clock';
import { addDays, toInstant, toLocalDate } from '../dates';
import { createRecord } from '../records';
import { ReminderSchema } from '../schema';
import { followUpBaseline, isOpenCommitment } from '../services/people';
import type { Bill, Commitment, Id, Instant, LocalDate, Person, Reminder, Rule } from '../schema';

/**
 * Reminder rules turn bills and unanswered commitments into queued
 * notifications. `computeReminders` says which reminders should exist for
 * the sources known right now — including ones whose fire time is still
 * ahead, so a resident shell can deliver them without the frontend being
 * awake to prepare the row that morning (week 11); `reconcileReminders`
 * says which of those are new. The key names the thing being reminded
 * about (rule, entity, due date), never the fire time, so re-evaluating
 * every minute cannot queue duplicates, and a dismissed reminder stays
 * dismissed. Wording carries explicit dates rather than "in 3 days", which
 * would be stale by the time a prepared row is delivered.
 */

/** Reminders fire at 09:00 local on the day they become relevant. */
export const REMINDER_HOUR_MIN = 9 * 60;

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

/**
 * Every reminder the enabled rules call for, given the sources known at
 * `now`. Fire times may be in the future: the row waits in the queue.
 * - `billDueWithin(days)`: each unpaid bill, firing at 09:00 on the day it
 *   enters the window (due − days); an overdue or late-found bill fires as
 *   soon as a scheduler sees it, because that day has passed;
 * - `followUpAfter(days)`: each open commitment owed to me, firing at 09:00
 *   on the day the quiet period runs out: the later of the commitment's
 *   creation and the person's last contact, plus `days` (week 12: an old
 *   contact date never makes a new promise overdue). A deleted person has
 *   no follow-ups.
 * One row per stored source: a recurring bill's later occurrences do not
 * exist until the bill does, so nothing is expanded ahead of the data.
 */
export function computeReminders(snapshot: ReminderSnapshot, _now: Date): ReminderDraft[] {
  const out: ReminderDraft[] = [];
  const personById = new Map((snapshot.people ?? []).map((p) => [p.id, p]));

  for (const rule of reminderRules(snapshot.rules)) {
    const c = rule.config;
    if (c.kind === 'billDueWithin') {
      for (const bill of snapshot.bills ?? []) {
        if (bill.deletedAt !== null || bill.paid) continue;
        const enters = addDays(bill.dueAt, -c.days);
        const amount = bill.amount
          ? `${bill.amount}${bill.currency ? ` ${bill.currency}` : ''}`
          : '';
        out.push({
          key: reminderKey(rule.id, bill.id, bill.dueAt),
          ruleId: rule.id,
          entityType: 'bill',
          entityId: bill.id,
          fireAt: fireOn(enters),
          title: `${bill.title} due ${bill.dueAt}`,
          body: amount,
        });
      }
    } else {
      for (const commitment of snapshot.commitments ?? []) {
        if (!isOpenCommitment(commitment) || commitment.direction !== 'owed-to-me') continue;
        const person = personById.get(commitment.personId);
        // Only a live person's promises are followed up; the caller passes live people.
        if (snapshot.people && !person) continue;
        const since = toLocalDate(new Date(followUpBaseline(commitment, person)));
        const expires = addDays(since, c.days);
        out.push({
          key: reminderKey(rule.id, commitment.id, expires),
          ruleId: rule.id,
          entityType: 'commitment',
          entityId: commitment.id,
          fireAt: fireOn(expires),
          title: `Follow up${person ? ` with ${person.name}` : ''}`,
          body: `No reply on “${commitment.text}” since ${since}`,
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
