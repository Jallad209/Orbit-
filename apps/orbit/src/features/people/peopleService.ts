import {
  CommitmentSchema,
  PersonSchema,
  comparePeople,
  countCommitments,
  createRecord,
  followUpBaseline,
  isOpenCommitment,
  openCommitmentsOf,
  recordContact as recordContactRule,
  systemClock,
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
}

export async function createPerson(
  repo: Repository,
  fields: PersonFields,
  clock: Clock = systemClock,
): Promise<Person> {
  const name = fields.name.trim();
  if (!name) throw new Error('A name is required.');
  return mutate(repo, (tx) =>
    tx.people.upsert(createRecord(PersonSchema, clock, { name, contact: fields.contact ?? '' })),
  );
}

/** Edit name or contact against the record the user saw; independent edits merge. */
export async function updatePerson(
  repo: Repository,
  base: Person,
  patch: Partial<Pick<Person, 'name' | 'contact'>>,
): Promise<Person> {
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('A name is required.');
  return mutate(repo, async (tx) => {
    const current = await currentRecord(tx.people, { id: base.id }, { noun: 'person' });
    return tx.people.upsert(
      mergePatch(current, base, {
        ...patch,
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      }),
    );
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
