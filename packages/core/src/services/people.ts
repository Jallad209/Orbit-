import type { Commitment, Id, Instant, Person } from '../schema';

/**
 * People and commitments (week 12). Pure rules shared by the people
 * screens, the insight detector, the reminder rules, and the weekly
 * review, so "how many open commitments" and "when does a follow-up
 * count from" have one definition each.
 */

/** A commitment that is still outstanding: live and open, whichever direction. */
export function isOpenCommitment(c: Commitment): boolean {
  return c.deletedAt === null && c.status === 'open';
}

export interface CommitmentCounts {
  open: number;
  owedByMe: number;
  owedToMe: number;
}

/** The week-11 count semantics: open commitments split by direction. */
export function countCommitments(open: readonly Commitment[]): CommitmentCounts {
  let owedByMe = 0;
  for (const c of open) if (c.direction === 'owed-by-me') owedByMe += 1;
  return { open: open.length, owedByMe, owedToMe: open.length - owedByMe };
}

/** Live open commitments of one person, oldest first. */
export function openCommitmentsOf(commitments: readonly Commitment[], personId: Id): Commitment[] {
  return commitments
    .filter((c) => c.personId === personId && isOpenCommitment(c))
    .sort(compareCommitments);
}

/** Due date (null last), then creation, then id. */
export function compareCommitments(a: Commitment, b: Commitment): number {
  if (a.dueAt !== b.dueAt) {
    if (a.dueAt === null) return 1;
    if (b.dueAt === null) return -1;
    return a.dueAt < b.dueAt ? -1 : 1;
  }
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Name, then id, so two people with one name keep a stable order. */
export function comparePeople(a: Person, b: Person): number {
  const byName = a.name.localeCompare(b.name);
  return byName !== 0 ? byName : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function validInstant(value: string | null | undefined): Instant | null {
  if (!value) return null;
  return Number.isFinite(new Date(value).getTime()) ? value : null;
}

/**
 * When the quiet period of an owed-to-me commitment counts from: the later
 * of the commitment's creation and the person's last recorded contact.
 * A person's old contact date cannot make a commitment created today
 * overdue, and a reply after the promise restarts the wait.
 */
export function followUpBaseline(
  commitment: Pick<Commitment, 'createdAt'>,
  person: Pick<Person, 'lastContactAt'> | undefined,
): Instant {
  const created = validInstant(commitment.createdAt) ?? commitment.createdAt;
  const contact = validInstant(person?.lastContactAt);
  return contact && contact > created ? contact : created;
}

export type ContactOutcome =
  | { kind: 'recorded'; person: Person }
  /** The same instant is already recorded: nothing changed. */
  | { kind: 'unchanged'; person: Person }
  /** The stored contact is newer; moving it back needs an explicit correction. */
  | { kind: 'older'; person: Person; current: Instant };

/**
 * Record a reply or contact with a person. Updates `lastContactAt` only;
 * no commitment is completed by it. `at` defaults to now and may be an
 * explicit past instant; a future instant or an unparseable one is
 * refused. Unless `correct` is set, a timestamp older than the stored one
 * is reported rather than applied.
 */
export function recordContact(
  person: Person,
  at: Instant,
  now: Date,
  options: { correct?: boolean } = {},
): ContactOutcome {
  const instant = validInstant(at);
  if (!instant) throw new Error('The contact time is not a valid instant.');
  if (new Date(instant).getTime() > now.getTime() + 60_000)
    throw new Error('The contact time cannot be in the future.');
  const current = validInstant(person.lastContactAt);
  if (current === instant) return { kind: 'unchanged', person };
  if (current && instant < current && !options.correct) return { kind: 'older', person, current };
  return { kind: 'recorded', person: { ...person, lastContactAt: instant } };
}

export type CommitmentTransition = 'done' | 'dropped' | 'open';

/** Mark done, drop, or reopen: three explicit transitions, none implied by a reply. */
export function transitionCommitment(
  commitment: Commitment,
  status: CommitmentTransition,
): Commitment {
  if (commitment.deletedAt !== null) throw new Error('This commitment was deleted.');
  if (commitment.status === status) return commitment;
  return { ...commitment, status };
}

export interface CommitmentFieldErrors {
  text?: string;
  dueAt?: string;
  personId?: string;
}

export function validateCommitmentFields(fields: {
  text: string;
  dueAt: string | null;
  person: Person | undefined;
}): CommitmentFieldErrors {
  const errors: CommitmentFieldErrors = {};
  if (!fields.text.trim()) errors.text = 'Say what was promised.';
  if (fields.dueAt !== null && !validInstant(fields.dueAt)) errors.dueAt = 'Enter a real date.';
  if (!fields.person || fields.person.deletedAt !== null)
    errors.personId = 'Choose a person who exists.';
  return errors;
}
