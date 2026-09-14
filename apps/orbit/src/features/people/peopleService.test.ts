import { describe, expect, it } from 'vitest';
import { PersonSchema, RuleSchema, createRecord, fixedClock, reminderKey } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import type { Repository } from '@orbit/storage';
import {
  createCommitment,
  deleteCommitment,
  deletePerson,
  loadPeople,
  loadPerson,
  recordContact,
  restorePerson,
  setCommitmentStatus,
  updateCommitment,
} from './peopleService';

import type { FixedClock } from '@orbit/core';

/** A fresh clock per test: Sat 12 Sep 2026 09:00 UTC. */
const fresh = (): FixedClock => fixedClock('2026-09-12T09:00:00.000Z');

async function world(repo: Repository, clock: FixedClock) {
  const rule = await repo.rules.upsert(
    createRecord(RuleSchema, clock, {
      type: 'reminder',
      name: 'Chase',
      config: { kind: 'followUpAfter', days: 7 },
    }),
  );
  const omar = await repo.people.upsert(
    createRecord(PersonSchema, clock, { name: 'Omar', lastContactAt: '2026-09-01T10:00:00.000Z' }),
  );
  const a = await createCommitment(
    repo,
    omar.id,
    { text: 'Interview feedback', direction: 'owed-to-me', dueAt: null },
    clock,
  );
  const b = await createCommitment(
    repo,
    omar.id,
    { text: 'Reference letter', direction: 'owed-to-me', dueAt: null },
    clock,
  );
  const mine = await createCommitment(
    repo,
    omar.id,
    { text: 'Send CV', direction: 'owed-by-me', dueAt: '2026-09-20T23:59:00.000Z' },
    clock,
  );
  return { rule, omar, a, b, mine };
}

const pendingKeys = async (repo: Repository) =>
  (await repo.reminders.query((r) => r.status === 'pending')).map((r) => r.key).sort();

describe('people service', () => {
  it('lists people with counts split by direction and separates deleted people', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const { omar } = await world(repo, clock);
    const lina = await repo.people.upsert(createRecord(PersonSchema, clock, { name: 'Lina' }));
    const list = await loadPeople(repo);
    expect(list.people.map((r) => r.person.name)).toEqual(['Lina', 'Omar']);
    expect(list.people[1]!.counts).toEqual({ open: 3, owedByMe: 1, owedToMe: 2 });
    expect(list.deleted).toEqual([]);
    await deletePerson(repo, lina.id, clock);
    const again = await loadPeople(repo);
    expect(again.people.map((r) => r.person.id)).toEqual([omar.id]);
    expect(again.deleted.map((p) => p.id)).toEqual([lina.id]);
  });

  it('a new commitment counts from its own creation, not the older contact date', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const { rule, a } = await world(repo, clock);
    // Created 12 Sep with last contact 1 Sep: the follow-up is 19 Sep, not 8 Sep.
    expect(await pendingKeys(repo)).toContain(reminderKey(rule.id, a.id, '2026-09-19'));
    const detail = (await loadPerson(repo, a.personId))!;
    expect(detail.followUps.get(a.id)).toMatchObject({ since: a.createdAt });
    expect(detail.followUps.get(a.id)?.fireAt?.slice(0, 10)).toBe('2026-09-19');
  });

  it('recording a reply restarts every owed-to-me follow-up and completes nothing', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const { rule, omar, a, b, mine } = await world(repo, clock);
    const before = await pendingKeys(repo);
    expect(before).toHaveLength(2);
    clock.advance(3 * 86_400_000); // 15 Sep
    const outcome = await recordContact(repo, omar, clock.now().toISOString(), { clock });
    expect(outcome.kind).toBe('recorded');
    const person = (await repo.people.get(omar.id))!;
    expect(person.lastContactAt).toBe(clock.now().toISOString());
    for (const c of [a, b, mine]) expect((await repo.commitments.get(c.id))!.status).toBe('open');
    const after = await pendingKeys(repo);
    expect(after).toEqual(
      [reminderKey(rule.id, a.id, '2026-09-22'), reminderKey(rule.id, b.id, '2026-09-22')].sort(),
    );
    // The old keys are cancelled tombstones (they may revive), not deleted history.
    const old = await repo.reminders.query((r) => before.includes(r.key), { includeDeleted: true });
    expect(old.every((r) => r.deletedAt !== null && r.status === 'pending')).toBe(true);
    // Repeating the same instant is a no-op, not a new episode.
    const again = await recordContact(repo, person, clock.now().toISOString(), { clock });
    expect(again.kind).toBe('unchanged');
    expect(await pendingKeys(repo)).toEqual(after);
    // Moving the contact backwards is refused until corrected explicitly.
    const back = await recordContact(repo, person, '2026-09-13T10:00:00.000Z', { clock });
    expect(back).toMatchObject({ kind: 'older', current: clock.now().toISOString() });
    const corrected = await recordContact(repo, person, '2026-09-13T10:00:00.000Z', {
      clock,
      correct: true,
    });
    expect(corrected.kind).toBe('recorded');
    expect(await pendingKeys(repo)).toContain(reminderKey(rule.id, a.id, '2026-09-20'));
  });

  it('done, drop, and reopen are separate; completing an owed-to-me promise removes its follow-up', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const { rule, a, b } = await world(repo, clock);
    const done = await setCommitmentStatus(repo, a, 'done', clock);
    expect(done.status).toBe('done');
    expect(await pendingKeys(repo)).toEqual([reminderKey(rule.id, b.id, '2026-09-19')]);
    const dropped = await setCommitmentStatus(repo, b, 'dropped', clock);
    expect(dropped.status).toBe('dropped');
    expect(await pendingKeys(repo)).toEqual([]);
    const reopened = await setCommitmentStatus(repo, dropped, 'open', clock);
    expect(reopened.status).toBe('open');
    expect(await pendingKeys(repo)).toEqual([reminderKey(rule.id, b.id, '2026-09-19')]);
    const detail = (await loadPerson(repo, a.personId))!;
    expect(detail.done.map((c) => c.id)).toEqual([a.id]);
    expect(detail.open.map((c) => c.id)).toContain(b.id);
  });

  it('edits check the fresh record and validate the merged fields', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const { a } = await world(repo, clock);
    clock.advance(1000);
    const renamed = await updateCommitment(repo, a, { text: 'Interview feedback (v2)' }, clock);
    expect(renamed.text).toBe('Interview feedback (v2)');
    // A stale base whose patched field changed underneath is a conflict.
    await expect(updateCommitment(repo, a, { text: 'stale' }, clock)).rejects.toMatchObject({
      code: 'changed',
    });
    // Independent fields merge.
    const dated = await updateCommitment(repo, a, { dueAt: '2026-09-30T23:59:00.000Z' }, clock);
    expect(dated).toMatchObject({
      text: 'Interview feedback (v2)',
      dueAt: '2026-09-30T23:59:00.000Z',
    });
    await expect(updateCommitment(repo, dated, { text: '   ' }, clock)).rejects.toThrow(
      'Say what was promised.',
    );
    await expect(
      createCommitment(repo, '00000000-0000-7000-8000-000000000001', {
        text: 'x',
        direction: 'owed-by-me',
        dueAt: null,
      }),
    ).rejects.toThrow('Choose a person who exists.');
  });

  it('deleting a person keeps commitments and links, silences follow-ups, and restore brings them back', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const { rule, omar, a, b } = await world(repo, clock);
    await deletePerson(repo, omar.id, clock);
    expect((await repo.people.get(omar.id))!.deletedAt).not.toBeNull();
    for (const c of [a, b]) {
      const row = (await repo.commitments.get(c.id))!;
      expect(row.deletedAt).toBeNull();
      expect(row.status).toBe('open');
    }
    expect(await pendingKeys(repo)).toEqual([]);
    const detail = (await loadPerson(repo, omar.id))!;
    expect(detail.person.deletedAt).not.toBeNull();
    expect(detail.open).toHaveLength(3);
    await restorePerson(repo, omar.id, clock);
    expect((await repo.people.get(omar.id))!.deletedAt).toBeNull();
    expect(await pendingKeys(repo)).toEqual(
      [reminderKey(rule.id, a.id, '2026-09-19'), reminderKey(rule.id, b.id, '2026-09-19')].sort(),
    );
    // Deleting one commitment deletes only it.
    await deleteCommitment(repo, a.id, clock);
    expect((await repo.commitments.get(a.id))!.deletedAt).not.toBeNull();
    expect((await repo.people.get(omar.id))!.deletedAt).toBeNull();
    expect(await pendingKeys(repo)).toEqual([reminderKey(rule.id, b.id, '2026-09-19')]);
  });

  it('a contact write that fails midway commits neither the person nor the queue', async () => {
    const clock = fresh();
    const repo = createMemoryRepository({ clock });
    const { omar } = await world(repo, clock);
    const before = await pendingKeys(repo);
    // A repository whose reminder writes fail, at every transaction depth.
    const breakReminders = (r: Repository): Repository =>
      ({
        ...r,
        reminders: {
          ...r.reminders,
          upsert: async () => {
            throw new Error('disk full');
          },
        },
        transaction: <T>(fn: (tx: Repository) => Promise<T>) =>
          r.transaction((tx) => fn(breakReminders(tx))),
      }) as Repository;
    const broken = breakReminders(repo);
    clock.advance(86_400_000);
    await expect(
      recordContact(repo, omar, clock.now().toISOString(), { clock }).then(() =>
        recordContact(broken, omar, '2026-09-12T12:00:00.000Z', { clock, correct: true }),
      ),
    ).rejects.toThrow('disk full');
    // The first call committed; the second rolled back entirely.
    const person = (await repo.people.get(omar.id))!;
    expect(person.lastContactAt).toBe(clock.now().toISOString());
    expect((await pendingKeys(repo)).length).toBe(before.length);
  });
});
