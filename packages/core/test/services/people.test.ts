import { describe, expect, it } from 'vitest';
import {
  comparePeople,
  countCommitments,
  followUpBaseline,
  isOpenCommitment,
  openCommitmentsOf,
  recordContact,
  transitionCommitment,
  validateCommitmentFields,
} from '../../src/services/people';
import { aCommitment, aPerson, testClock } from '../builders';

const clock = testClock(); // Sat 12 Sep 2026 09:00 local

describe('commitment counts (shared with the week-11 badge)', () => {
  it('counts live open commitments split by direction and sits exactly at the 2/3 boundary', () => {
    const p = aPerson({ name: 'Omar' }, clock);
    const open = [
      aCommitment({ personId: p.id, direction: 'owed-by-me' }, clock),
      aCommitment({ personId: p.id, direction: 'owed-to-me' }, clock),
      aCommitment({ personId: p.id, direction: 'owed-to-me' }, clock),
    ];
    const rows = [
      ...open,
      aCommitment({ personId: p.id, status: 'done' }, clock),
      aCommitment({ personId: p.id, status: 'dropped' }, clock),
      { ...aCommitment({ personId: p.id }, clock), deletedAt: clock.now().toISOString() },
      aCommitment({ personId: aPerson({}, clock).id }, clock),
    ];
    const mine = openCommitmentsOf(rows, p.id);
    expect(mine).toHaveLength(3);
    expect(countCommitments(mine)).toEqual({ open: 3, owedByMe: 1, owedToMe: 2 });
    expect(countCommitments(mine.slice(0, 2))).toEqual({ open: 2, owedByMe: 1, owedToMe: 1 });
    expect(rows.filter(isOpenCommitment)).toHaveLength(4);
  });

  it('orders people by name with an id tie-breaker', () => {
    const a = aPerson({ name: 'Zed' }, clock);
    const b = aPerson({ name: 'Amy' }, clock);
    const c = { ...aPerson({ name: 'Amy' }, clock), id: '00000000-0000-7000-8000-000000000009' };
    expect([a, b, c].sort(comparePeople).map((p) => p.id)).toEqual([c.id, b.id, a.id]);
  });
});

describe('follow-up baseline', () => {
  it('is the later of the commitment creation and the last contact', () => {
    const made = aCommitment({}, clock);
    expect(followUpBaseline(made, undefined)).toBe(made.createdAt);
    expect(followUpBaseline(made, { lastContactAt: '2026-08-01T00:00:00.000Z' })).toBe(
      made.createdAt,
    );
    expect(followUpBaseline(made, { lastContactAt: '2026-09-20T00:00:00.000Z' })).toBe(
      '2026-09-20T00:00:00.000Z',
    );
    expect(followUpBaseline(made, { lastContactAt: 'garbage' })).toBe(made.createdAt);
    expect(followUpBaseline(made, { lastContactAt: null })).toBe(made.createdAt);
  });
});

describe('recordContact', () => {
  it('updates last contact only, defaults to now, and accepts an explicit past instant', () => {
    const p = aPerson({ lastContactAt: null }, clock);
    const now = clock.now();
    const a = recordContact(p, now.toISOString(), now);
    expect(a).toMatchObject({ kind: 'recorded', person: { lastContactAt: now.toISOString() } });
    const past = recordContact(p, '2026-09-01T10:00:00.000Z', now);
    expect(past.kind).toBe('recorded');
    expect(() => recordContact(p, '2026-10-01T10:00:00.000Z', now)).toThrow(/future/);
    expect(() => recordContact(p, 'nope', now)).toThrow(/valid instant/);
  });

  it('repeating the same instant is a no-op and moving backwards needs an explicit correction', () => {
    const p = aPerson({ lastContactAt: '2026-09-10T10:00:00.000Z' }, clock);
    const now = clock.now();
    expect(recordContact(p, '2026-09-10T10:00:00.000Z', now)).toEqual({
      kind: 'unchanged',
      person: p,
    });
    const older = recordContact(p, '2026-09-01T10:00:00.000Z', now);
    expect(older).toMatchObject({ kind: 'older', current: '2026-09-10T10:00:00.000Z' });
    expect(recordContact(p, '2026-09-01T10:00:00.000Z', now, { correct: true })).toMatchObject({
      kind: 'recorded',
      person: { lastContactAt: '2026-09-01T10:00:00.000Z' },
    });
  });
});

describe('commitment transitions and validation', () => {
  it('done, drop, and reopen are explicit and distinct', () => {
    const c = aCommitment({}, clock);
    expect(transitionCommitment(c, 'done').status).toBe('done');
    expect(transitionCommitment(c, 'dropped').status).toBe('dropped');
    expect(transitionCommitment(transitionCommitment(c, 'done'), 'open').status).toBe('open');
    expect(transitionCommitment(c, 'open')).toBe(c);
    expect(() =>
      transitionCommitment({ ...c, deletedAt: clock.now().toISOString() }, 'done'),
    ).toThrow(/deleted/);
  });

  it('requires a live person, nonempty text, and a valid optional due date', () => {
    const p = aPerson({}, clock);
    expect(validateCommitmentFields({ text: '  ', dueAt: 'x', person: undefined })).toEqual({
      text: 'Say what was promised.',
      dueAt: 'Enter a real date.',
      personId: 'Choose a person who exists.',
    });
    expect(
      validateCommitmentFields({
        text: 'Send slides',
        dueAt: null,
        person: { ...p, deletedAt: clock.now().toISOString() },
      }),
    ).toEqual({ personId: 'Choose a person who exists.' });
    expect(
      validateCommitmentFields({
        text: 'Send slides',
        dueAt: '2026-09-20T09:00:00.000Z',
        person: p,
      }),
    ).toEqual({});
  });
});
