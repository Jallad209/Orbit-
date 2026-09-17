/**
 * Write a small, known dataset straight into a SQLite data file with the
 * production adapter, so a cold desktop launch starts from populated data.
 * Returns the ids the tests navigate to.
 */
import { createRecord, systemClock } from '@orbit/core';
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
  const task = createRecord(TaskSchema, clock, { title: 'Campaign cold task', status: 'open' });
  const deleted = createRecord(TaskSchema, clock, {
    title: 'Campaign deleted task',
    status: 'open',
  });
  const bill = createRecord(BillSchema, clock, {
    title: 'Campaign bill',
    amount: 12,
    dueAt: '2026-10-01',
  });
  const person = createRecord(PersonSchema, clock, { name: 'Campaign Person' });
  const commitment = createRecord(CommitmentSchema, clock, {
    text: 'Campaign commitment',
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
