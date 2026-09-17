import {
  CommitmentSchema,
  PersonSchema,
  ReminderSchema,
  comparePeople,
  countCommitments,
  createRecord,
  newId,
  followUpBaseline,
  isOpenCommitment,
  openCommitmentsOf,
  recordContact as recordContactRule,
  systemClock,
  toInstant,
  transitionCommitment,
  validateCommitmentFields,
} from '@orbit/core';
import type {
  Clock,
  Commitment,
  CommitmentCounts,
  ContactOutcome,
  Id,
  Instant,
  Person,
} from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { ConflictError, currentRecord, mergePatch, mutate } from '@/data/mutations';
import { reconcileReminderQueue } from '@/features/reminders/reminderService';

async function reconcilePersonFollowUp(
  tx: Repository,
  person: Person,
  clock: Clock,
): Promise<void> {
  const existing = await tx.reminders.query(
    (item) => item.source === 'person-follow-up' && item.entityId === person.id,
  );
  for (const reminder of existing) await tx.reminders.softDelete(reminder.id);
  if (person.deletedAt !== null || person.followUpDate === null) return;
  const minute = person.followUpTime ?? 9 * 60;
  const fireAt = toInstant(person.followUpDate, minute).toISOString();
  await tx.reminders.upsert(
    createRecord(ReminderSchema, clock, {
      id: newId(),
      key: `person-follow-up:${person.id}:${person.followUpDate}:${minute}`,
      ruleId: null,
      source: 'person-follow-up',
      entityType: 'person',
      entityId: person.id,
      destination: `/people/${person.id}`,
      fireAt,
      title: `Follow up with ${person.name}`,
      body: person.followUpTime === null ? 'Scheduled for today.' : 'Scheduled follow-up.',
      status: 'pending',
    }),
  );
}

/**
 * People and commitments (week 12). Every write re-reads the current row
 * inside its transaction, applies one of the core rules, and reconciles
 * the reminder queue in the same transaction, so a follow-up can never
 * outlive the contact or commitment change that made it obsolete.
 */

export interface PersonRow {
  person: Person;
  counts: CommitmentCounts;
}

export interface PeopleList {
  people: PersonRow[];
  deleted: Person[];
}

export async function loadPeople(repo: Repository): Promise<PeopleList> {
  const [people, commitments] = await Promise.all([
    repo.people.list({ includeDeleted: true }),
    repo.commitments.list(),
  ]);
  const live = people.filter((p) => p.deletedAt === null).sort(comparePeople);
  return {
    people: live.map((person) => ({
      person,
      counts: countCommitments(openCommitmentsOf(commitments, person.id)),
    })),
    deleted: people.filter((p) => p.deletedAt !== null).sort(comparePeople),
  };
}

export interface FollowUp {
  /** When the quiet period for this commitment counts from. */
  since: Instant;
  /** The queued reminder's fire time, when a follow-up rule is enabled. */
  fireAt: Instant | null;
}

export interface PersonDetail {
  person: Person;
  open: Commitment[];
  done: Commitment[];
  dropped: Commitment[];
  counts: CommitmentCounts;
  /** Follow-up status per open owed-to-me commitment. */
  followUps: Map<Id, FollowUp>;
}

export async function loadPerson(repo: Repository, id: Id): Promise<PersonDetail | null> {
  const person = await repo.people.get(id);
  if (!person) return null;
  const [commitments, reminders] = await Promise.all([
    repo.commitments.query((c) => c.personId === id),
    repo.reminders.query((r) => r.entityType === 'commitment' && r.status === 'pending'),
  ]);
  const open = openCommitmentsOf(commitments, id);
  const byStatus = (status: Commitment['status']) =>
    commitments
      .filter((c) => c.status === status)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  const followUps = new Map<Id, FollowUp>();
  for (const c of open) {
    if (c.direction !== 'owed-to-me') continue;
    const queued = reminders.find((r) => r.entityId === c.id);
    followUps.set(c.id, { since: followUpBaseline(c, person), fireAt: queued?.fireAt ?? null });
  }
  return {
    person,
    open,
    done: byStatus('done'),
    dropped: byStatus('dropped'),
    counts: countCommitments(open),
    followUps,
  };
}

export interface PersonFields {
  name: string;
  contact?: string;
  followUpDate?: string | null;
  followUpTime?: number | null;
}

export async function createPerson(
  repo: Repository,
  fields: PersonFields,
  clock: Clock = systemClock,
): Promise<Person> {
  const name = fields.name.trim();
  if (!name) throw new Error('A name is required.');
  return mutate(repo, async (tx) => {
    const person = await tx.people.upsert(
      createRecord(PersonSchema, clock, {
        name,
        contact: fields.contact ?? '',
        followUpDate: fields.followUpDate ?? null,
        followUpTime: fields.followUpTime ?? null,
      }),
    );
    await reconcilePersonFollowUp(tx, person, clock);
    return person;
  });
}

/** Edit name or contact against the record the user saw; independent edits merge. */
export async function updatePerson(
  repo: Repository,
  base: Person,
  patch: Partial<Pick<Person, 'name' | 'contact' | 'followUpDate' | 'followUpTime'>>,
  clock: Clock = systemClock,
): Promise<Person> {
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('A name is required.');
  return mutate(repo, async (tx) => {
    const current = await currentRecord(tx.people, { id: base.id }, { noun: 'person' });
    const person = await tx.people.upsert(
      mergePatch(current, base, {
        ...patch,
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      }),
    );
    await reconcilePersonFollowUp(tx, person, clock);
    return person;
  });
}

/**
 * Record a reply or contact. Only `lastContactAt` changes; every open
 * owed-to-me commitment's follow-up restarts through the reminder
 * reconcile in the same transaction. No commitment is completed.
 */
export async function recordContact(
  repo: Repository,
  base: Person,
  at: Instant,
  options: { correct?: boolean; clock?: Clock } = {},
): Promise<ContactOutcome> {
  const clock = options.clock ?? systemClock;
  return mutate(repo, async (tx) => {
    const current = await currentRecord(tx.people, { id: base.id }, { noun: 'person' });
    const outcome = recordContactRule(current, at, clock.now(), { correct: options.correct });
    if (outcome.kind !== 'recorded') return outcome;
    const person = await tx.people.upsert(outcome.person);
    await reconcileReminderQueue(tx, clock);
    return { kind: 'recorded', person };
  });
}

/** How many live commitments a deletion would hide, for the confirmation. */
export async function deletionImpact(repo: Repository, personId: Id): Promise<number> {
  return (await repo.commitments.query((c) => c.personId === personId)).length;
}

/**
 * Soft-delete a person. Their commitments and links stay stored for
 * recovery (hidden from active surfaces); follow-ups are cancelled by the
 * reconcile because a deleted person has none. Nothing is transferred or
 * marked done.
 */
export async function deletePerson(
  repo: Repository,
  personId: Id,
  clock: Clock = systemClock,
): Promise<void> {
  await mutate(repo, async (tx) => {
    await currentRecord(tx.people, { id: personId }, { noun: 'person' });
    await tx.people.softDelete(personId);
    const deleted = await tx.people.get(personId);
    if (deleted) await reconcilePersonFollowUp(tx, deleted, clock);
    await reconcileReminderQueue(tx, clock);
  });
}

/** Restore a deleted person; their still-open commitments come back with follow-ups re-queued. */
export async function restorePerson(
  repo: Repository,
  personId: Id,
  clock: Clock = systemClock,
): Promise<Person> {
  return mutate(repo, async (tx) => {
    const current = await currentRecord(
      tx.people,
      { id: personId },
      { noun: 'person', allowDeleted: true },
    );
    if (current.deletedAt === null) return current;
    const person = await tx.people.upsert({ ...current, deletedAt: null });
    await reconcilePersonFollowUp(tx, person, clock);
    await reconcileReminderQueue(tx, clock);
    return person;
  });
}

export interface CommitmentFields {
  text: string;
  direction: Commitment['direction'];
  dueAt: Instant | null;
}

export async function createCommitment(
  repo: Repository,
  personId: Id,
  fields: CommitmentFields,
  clock: Clock = systemClock,
): Promise<Commitment> {
  return mutate(repo, async (tx) => {
    const person = await tx.people.get(personId);
    const errors = validateCommitmentFields({ text: fields.text, dueAt: fields.dueAt, person });
    const first = Object.values(errors)[0];
    if (first) throw new Error(first);
    const commitment = await tx.commitments.upsert(
      createRecord(CommitmentSchema, clock, {
        personId,
        text: fields.text.trim(),
        direction: fields.direction,
        dueAt: fields.dueAt,
        status: 'open',
      }),
    );
    await reconcileReminderQueue(tx, clock);
    return commitment;
  });
}

export async function updateCommitment(
  repo: Repository,
  base: Commitment,
  patch: Partial<Pick<Commitment, 'text' | 'direction' | 'dueAt'>>,
  clock: Clock = systemClock,
): Promise<Commitment> {
  return mutate(repo, async (tx) => {
    const current = await currentRecord(tx.commitments, { id: base.id }, { noun: 'commitment' });
    const person = await tx.people.get(current.personId);
    const merged = mergePatch<Commitment>(current, base, patch);
    const errors = validateCommitmentFields({ text: merged.text, dueAt: merged.dueAt, person });
    const first = Object.values(errors)[0];
    if (first) throw new Error(first);
    const next = await tx.commitments.upsert({ ...merged, text: merged.text.trim() });
    await reconcileReminderQueue(tx, clock);
    return next;
  });
}

/** Mark done, drop, or reopen: separate explicit actions, each reconciling follow-ups. */
export async function setCommitmentStatus(
  repo: Repository,
  base: Commitment,
  status: Commitment['status'],
  clock: Clock = systemClock,
): Promise<Commitment> {
  return mutate(repo, async (tx) => {
    const current = await currentRecord(tx.commitments, { id: base.id }, { noun: 'commitment' });
    const next = await tx.commitments.upsert(transitionCommitment(current, status));
    await reconcileReminderQueue(tx, clock);
    return next;
  });
}

/** Soft-delete one commitment only; the person is untouched. */
export async function deleteCommitment(
  repo: Repository,
  commitmentId: Id,
  clock: Clock = systemClock,
): Promise<void> {
  await mutate(repo, async (tx) => {
    await currentRecord(tx.commitments, { id: commitmentId }, { noun: 'commitment' });
    await tx.commitments.softDelete(commitmentId);
    await reconcileReminderQueue(tx, clock);
  });
}

export { ConflictError, isOpenCommitment };
