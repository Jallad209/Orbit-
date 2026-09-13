import { computeReminders, dueReminders, systemClock, toReminderRecords } from '@orbit/core';
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
  return repo.transaction(async (tx) => {
    // The read AND write must share ownership, including across desktop windows.
    const [rules, bills, commitments, people, reminders] = await Promise.all([
      tx.rules.list({ includeDeleted: true }),
      tx.bills.list({ includeDeleted: true }),
      tx.commitments.list({ includeDeleted: true }),
      tx.people.list({ includeDeleted: true }),
      tx.reminders.list({ includeDeleted: true }),
    ]);
    const desired = new Map(
      computeReminders(
        { rules, bills, commitments, people: people.filter((p) => p.deletedAt === null) },
        clock.now(),
      ).map((d) => [d.key, d]),
    );
    const byKey = new Map<string, Reminder>();
    // Keep terminal history in preference to pending duplicates from older builds.
    for (const r of [...reminders].sort(
      (a, b) =>
        Number(a.status === 'pending') - Number(b.status === 'pending') ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    )) {
      if (byKey.has(r.key)) {
        if (r.deletedAt === null) await tx.reminders.softDelete(r.id);
      } else byKey.set(r.key, r);
    }
    const changed: Reminder[] = [];
    for (const r of byKey.values()) {
      if (r.status === 'pending' && r.deletedAt === null && !desired.has(r.key))
        await tx.reminders.softDelete(r.id);
    }
    for (const draft of desired.values()) {
      const existing = byKey.get(draft.key);
      if (existing && existing.status !== 'pending') continue; // never resurrect delivered/dismissed reminders
      const entity =
        draft.entityType === 'bill'
          ? bills.find((b) => b.id === draft.entityId)
          : commitments.find((c) => c.id === draft.entityId);
      const person =
        entity && 'personId' in entity ? people.find((p) => p.id === entity.personId) : undefined;
      const rule = rules.find((r) => r.id === draft.ruleId);
      const sourceAt =
        [entity?.updatedAt, person?.updatedAt, rule?.updatedAt]
          .filter((at): at is string => !!at)
          .sort()
          .at(-1) ?? '';
      const next = existing
        ? { ...existing, ...draft, deletedAt: null }
        : toReminderRecords([draft], clock)[0]!;
      if (
        !existing ||
        existing.deletedAt !== null ||
        existing.fireAt !== next.fireAt ||
        existing.title !== next.title ||
        existing.body !== next.body ||
        existing.updatedAt < sourceAt
      ) {
        // Also refresh the source watermark so the native worker can reject stale queue rows.
        next.updatedAt = [clock.now().toISOString(), sourceAt].sort().at(-1)!;
        changed.push(await tx.reminders.upsert(next, { preserveUpdatedAt: true }));
      }
    }
    return changed;
  });
}

/** Web tabs atomically claim a still-valid reminder, so only one displays it. */
export async function claimReminder(
  repo: Repository,
  reminder: Reminder,
  clock: Clock = systemClock,
): Promise<Reminder | undefined> {
  return repo.transaction(async (tx) => {
    await reconcileReminderQueue(tx, clock);
    const current = await tx.reminders.get(reminder.id);
    if (!current || !dueReminders([current], clock.now()).length) return undefined;
    return tx.reminders.upsert({ ...current, status: 'fired' });
  });
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
  const next = await repo.transaction(async (tx) => {
    const current = await tx.reminders.get(reminder.id);
    if (!current) throw new Error('This reminder no longer exists.');
    return tx.reminders.upsert({ ...current, status });
  });
  if (options.bump ?? true) bumpData();
  return next;
}
