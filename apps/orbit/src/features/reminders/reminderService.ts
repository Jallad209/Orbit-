import {
  ReminderSchema,
  computeReminders,
  createRecord,
  dueReminders,
  newId,
  systemClock,
  toReminderRecords,
} from '@orbit/core';
import type { Clock, EntityType, Id, Reminder } from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { bumpData } from '@/data/useQuery';

/**
 * Fill the reminder queue from the enabled reminder rules. Idempotent: the
 * key names the thing being reminded about, so running this every minute
 * on both runtimes creates each reminder once.
 */
export function reconcileReminderQueue(
  repo: Repository,
  clock: Clock = systemClock,
): Promise<Reminder[]> {
  // Returned directly rather than through an async wrapper, so a caller inside a transaction
  // awaits the transaction's own promise (see `currentRecord` for the Dexie zone rule).
  return repo.transaction(async (tx) => {
    // The read AND write must share ownership, including across desktop windows. The reads are
    // sequential on purpose: a `Promise.all` inside a nested Dexie transaction lets the parent
    // IndexedDB transaction commit before a caller's later writes (week 12).
    const rules = await tx.rules.list({ includeDeleted: true });
    const bills = await tx.bills.list({ includeDeleted: true });
    const commitments = await tx.commitments.list({ includeDeleted: true });
    const people = await tx.people.list({ includeDeleted: true });
    const reminders = await tx.reminders.list({ includeDeleted: true });
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
      if (r.source !== 'rule') continue;
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

export async function createDirectReminder(
  repo: Repository,
  input: {
    key: string;
    source: 'review-step' | 'person-follow-up' | 'monthly-spending';
    entityType: EntityType;
    entityId: Id;
    fireAt: string;
    title: string;
    body?: string;
    destination: string;
  },
  clock: Clock = systemClock,
): Promise<Reminder> {
  const existing = (await repo.reminders.query((item) => item.key === input.key)).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )[0];
  const record = existing
    ? { ...existing, ...input, ruleId: null, status: 'pending' as const, deletedAt: null }
    : createRecord(ReminderSchema, clock, {
        id: newId(),
        ...input,
        ruleId: null,
        status: 'pending',
      });
  const saved = await repo.reminders.upsert(record);
  bumpData();
  return saved;
}
