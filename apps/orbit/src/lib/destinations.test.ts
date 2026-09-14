import { describe, expect, it } from 'vitest';
import {
  BillSchema,
  CommitmentSchema,
  PersonSchema,
  ReminderSchema,
  createRecord,
  fixedClock,
  newWeeklyReview,
} from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { formatOrbitUri, parseOrbitUri, resolveDestination, routeFor } from './destinations';

const clock = fixedClock('2026-09-12T09:00:00.000Z');
const ID = '01a0a1b6-3ad4-7678-92cc-ae55e388b0a6';

describe('canonical routes', () => {
  it('maps every typed reference to exactly one screen', () => {
    expect(routeFor({ type: 'person', id: ID })).toBe(`/people/${ID}`);
    expect(routeFor({ type: 'commitment', id: ID })).toBeNull();
    expect(routeFor({ type: 'commitment', id: ID }, { personId: 'p' })).toBe(
      `/people/p?commitment=${ID}`,
    );
    expect(routeFor({ type: 'bill', id: ID })).toBe(`/bills/${ID}`);
    expect(routeFor({ type: 'note', id: ID })).toBe(`/notes/${ID}`);
    expect(routeFor({ type: 'task', id: ID })).toBe(`/tasks/${ID}`);
    expect(routeFor({ type: 'project', id: ID })).toBe(`/projects/${ID}`);
    expect(routeFor({ type: 'goal', id: ID })).toBe(`/goals/${ID}`);
    expect(routeFor({ type: 'review', id: ID })).toBe(`/review/weekly?review=${ID}`);
    expect(routeFor({ type: 'timelineBlock', id: ID, date: '2026-09-12' })).toBe(
      `/timeline?date=2026-09-12&block=${ID}`,
    );
    expect(routeFor({ type: 'reminder', id: ID })).toBeNull();
  });

  it('resolves reminders and commitments to their current record and reports missing ones', async () => {
    const repo = createMemoryRepository({ clock });
    const person = await repo.people.upsert(createRecord(PersonSchema, clock, { name: 'Omar' }));
    const commitment = await repo.commitments.upsert(
      createRecord(CommitmentSchema, clock, {
        personId: person.id,
        text: 'Slides',
        status: 'done',
      }),
    );
    const bill = await repo.bills.upsert(
      createRecord(BillSchema, clock, {
        title: 'Rent',
        amount: 1,
        dueAt: '2026-09-20',
        paid: true,
      }),
    );
    const reminder = await repo.reminders.upsert(
      createRecord(ReminderSchema, clock, {
        key: 'r:b:2026-09-20',
        ruleId: ID,
        entityType: 'bill',
        entityId: bill.id,
        fireAt: '2026-09-17T07:00:00.000Z',
        title: 'Rent due 2026-09-20',
      }),
    );
    // A completed commitment and a paid bill open in their current (historical) state.
    expect(await resolveDestination(repo, { type: 'commitment', id: commitment.id })).toMatchObject(
      {
        kind: 'route',
        path: `/people/${person.id}?commitment=${commitment.id}`,
      },
    );
    expect(await resolveDestination(repo, { type: 'reminder', id: reminder.id })).toMatchObject({
      kind: 'route',
      path: `/bills/${bill.id}`,
      destination: { type: 'reminder', id: reminder.id },
    });
    // Deleted or unknown records land on the missing page, never on a different record.
    await repo.bills.softDelete(bill.id);
    expect(await resolveDestination(repo, { type: 'reminder', id: reminder.id })).toMatchObject({
      kind: 'missing',
      // The page names the bill that is gone, which is what the user needs to know.
      path: `/missing?type=bill&id=${bill.id}`,
      destination: { type: 'reminder', id: reminder.id },
    });
    expect(await resolveDestination(repo, { type: 'reminder', id: ID })).toMatchObject({
      kind: 'missing',
    });
    await repo.people.softDelete(person.id);
    expect(await resolveDestination(repo, { type: 'commitment', id: commitment.id })).toMatchObject(
      {
        kind: 'missing',
      },
    );
    const review = await repo.weeklyReviews.upsert(newWeeklyReview(clock, '2026-09-12'));
    expect(await resolveDestination(repo, { type: 'review', id: review.id })).toMatchObject({
      kind: 'route',
      path: `/review/weekly?review=${review.id}`,
    });
    // A block that is gone still lands on its date.
    expect(
      await resolveDestination(repo, { type: 'timelineBlock', id: ID, date: '2026-09-12' }),
    ).toMatchObject({ kind: 'route', path: '/timeline?date=2026-09-12' });
  });
});

describe('orbit:// URIs', () => {
  it('accepts exactly the supported kinds with one UUID segment', () => {
    for (const kind of ['reminder', 'task', 'person', 'commitment', 'bill', 'note', 'review']) {
      expect(parseOrbitUri(`orbit://${kind}/${ID}`)).toEqual({ type: kind, id: ID });
    }
    expect(parseOrbitUri(`orbit://task/${ID}/`)).toEqual({ type: 'task', id: ID });
    expect(parseOrbitUri(`orbit://task/${ID.toUpperCase()}`)).toEqual({ type: 'task', id: ID });
    expect(formatOrbitUri({ type: 'reminder', id: ID })).toBe(`orbit://reminder/${ID}`);
  });

  it('rejects everything else without throwing', () => {
    const bad = [
      '',
      'orbit://',
      'orbit://task',
      `orbit://area/${ID}`,
      `orbit://timelineBlock/${ID}`,
      `orbit://task/${ID}/extra`,
      `orbit://task/not-a-uuid`,
      `orbit://task/${ID}?x=1`,
      `orbit://task/${ID}#frag`,
      `orbit://user:pw@task/${ID}`,
      `orbit://task:80/${ID}`,
      `orbit://task/${ID}%2Fmore`,
      `orbit://task%2F${ID}`,
      `orbit://task/${ID}\n`,
      `orbit://task/ ${ID}`,
      `http://task/${ID}`,
      `ORBIT://task/${ID}`,
      `orbit://Task/${ID}`,
      `orbit://task/${ID}${'a'.repeat(200)}`,
      `javascript:alert(1)`,
      `orbit://open-data-dir/C:%5Cusers`,
    ];
    for (const input of bad) expect(parseOrbitUri(input), input).toBeNull();
  });
});
