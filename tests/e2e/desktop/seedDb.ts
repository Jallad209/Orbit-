/**
 * Write a small, known dataset straight into a SQLite data file with the
 * production adapter, so a cold desktop launch starts from populated data.
 * Returns the ids the tests navigate to.
 */
import { createRecord, seedCount, seedWorld, systemClock } from '@orbit/core';
import { BillSchema, CommitmentSchema, PersonSchema, TaskSchema } from '@orbit/core';
import { createSqliteRepository } from '@orbit/storage';
import { betterSqliteDriver } from '@orbit/storage/test/betterSqliteDriver';

export interface SeededIds {
  taskId: string;
  billId: string;
  personId: string;
  commitmentId: string;
  deletedTaskId: string;
}

export async function seedKnownDataset(dbPath: string): Promise<SeededIds> {
  const driver = betterSqliteDriver(dbPath);
  const repo = await createSqliteRepository({ driver });
  const clock = systemClock;
  const task = createRecord(TaskSchema, clock, { title: 'Cold-launch task', status: 'open' });
  const deleted = createRecord(TaskSchema, clock, {
    title: 'Cold-launch deleted task',
    status: 'open',
  });
  const bill = createRecord(BillSchema, clock, {
    title: 'Cold-launch bill',
    amount: 12,
    dueAt: '2026-10-01',
  });
  const person = createRecord(PersonSchema, clock, { name: 'Cold-launch Person' });
  const commitment = createRecord(CommitmentSchema, clock, {
    text: 'Cold-launch commitment',
    personId: person.id,
  });
  await repo.transaction(async (tx) => {
    await tx.tasks.upsert(task);
    await tx.tasks.upsert({ ...deleted, deletedAt: clock.now().toISOString() });
    await tx.bills.upsert(bill);
    await tx.people.upsert(person);
    await tx.commitments.upsert(commitment);
  });
  await repo.close();
  return {
    taskId: task.id,
    billId: bill.id,
    personId: person.id,
    commitmentId: commitment.id,
    deletedTaskId: deleted.id,
  };
}

/** Seed the real SQLite adapter with the release performance dataset. */
export async function seedLarge(dbPath: string): Promise<number> {
  const driver = betterSqliteDriver(dbPath);
  const repo = await createSqliteRepository({ driver });
  const world = seedWorld({
    seed: 41,
    sizes: {
      tasks: 50_000,
      notes: 10_000,
      days: 120,
      projects: 1200,
      goals: 250,
      people: 200,
    },
  });
  await repo.transaction(async (tx) => {
    for (const row of world.areas) await tx.areas.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.goals) await tx.goals.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.projects) await tx.projects.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.milestones)
      await tx.milestones.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.tasks) await tx.tasks.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.events) await tx.events.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.routines) await tx.routines.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.routineInstances)
      await tx.routineInstances.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.notes) await tx.notes.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.people) await tx.people.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.commitments)
      await tx.commitments.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.bills) await tx.bills.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.blocks) await tx.blocks.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.dayCommitments)
      await tx.dayCommitments.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.sessions) await tx.sessions.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.rules) await tx.rules.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.insightStates)
      await tx.insightStates.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.captures) await tx.captures.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.reminders) await tx.reminders.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.appSettings)
      await tx.appSettings.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.weeklyReviews)
      await tx.weeklyReviews.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.weeklyReviewActions)
      await tx.weeklyReviewActions.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.dailyReviewDrafts)
      await tx.dailyReviewDrafts.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.dailyReflections)
      await tx.dailyReflections.upsert(row, { preserveUpdatedAt: true });
    for (const row of world.links) await tx.links.upsert(row, { preserveUpdatedAt: true });
  });
  await repo.close();
  return seedCount(world);
}
