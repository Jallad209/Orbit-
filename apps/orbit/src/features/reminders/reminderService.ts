import {
  computeReminders,
  dueReminders,
  reconcileReminders,
  systemClock,
  toReminderRecords,
} from '@orbit/core';
import type { Clock, Reminder } from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { bumpData } from '@/data/useQuery';

/**
 * Fill the reminder queue from the enabled reminder rules. Idempotent: the
 * key names the thing being reminded about, so running this every minute
 * on both runtimes creates each reminder once.
 */
export async function reconcileReminderQueue(
  repo: Repository,
  clock: Clock = systemClock,
): Promise<Reminder[]> {
  const [rules, bills, commitments, people, reminders] = await Promise.all([
    repo.rules.list(),
    repo.bills.list(),
    repo.commitments.list(),
    repo.people.list(),
    repo.reminders.list({ includeDeleted: true }),
  ]);
  const drafts = reconcileReminders(
    reminders,
    computeReminders({ rules, bills, commitments, people }, clock.now()),
  );
  if (!drafts.length) return [];
  const records = toReminderRecords(drafts, clock);
  await repo.transaction(async (tx) => {
    for (const r of records) await tx.reminders.upsert(r);
  });
  return records;
}

/** Pending reminders whose time has come, oldest first. */
export async function loadDueReminders(
  repo: Repository,
  clock: Clock = systemClock,
): Promise<Reminder[]> {
  return dueReminders(await repo.reminders.query((r) => r.status === 'pending'), clock.now());
}

export async function markReminder(
  repo: Repository,
  reminder: Reminder,
  status: Reminder['status'],
  options: { bump?: boolean } = {},
): Promise<Reminder> {
  const next = await repo.reminders.upsert({ ...reminder, status });
  if (options.bump ?? true) bumpData();
  return next;
}
