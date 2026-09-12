import 'fake-indexeddb/auto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { AreaSchema, TaskSchema, createRecord, fixedClock } from '@orbit/core';
import { createIndexedDbRepository, deleteIndexedDb } from '../src/indexeddb';
import { repositoryContract } from './contract';

// A fresh IDBFactory per open gives every test an isolated database.
repositoryContract('indexeddb', {
  open: async (clock) =>
    createIndexedDbRepository({
      name: 'orbit-contract',
      clock,
      indexedDB: new IDBFactory(),
      IDBKeyRange,
    }),
});

describe('IndexedDB persistence', () => {
  it('records and the op log survive closing and reopening the same database', async () => {
    const factory = new IDBFactory();
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const open = () =>
      createIndexedDbRepository({ name: 'orbit-persist', clock, indexedDB: factory, IDBKeyRange });

    const a = await open();
    const area = createRecord(AreaSchema, clock, { name: 'Health' });
    const task = createRecord(TaskSchema, clock, { title: 'Run' });
    await a.areas.upsert(area);
    await a.tasks.upsert(task);
    await a.tasks.softDelete(task.id);
    expect(await a.opLog.latestSeq()).toBe(3);
    await a.close();

    const b = await open();
    expect(await b.areas.get(area.id)).toEqual(area);
    expect(await b.tasks.count()).toBe(0);
    expect(await b.tasks.count({ includeDeleted: true })).toBe(1);
    expect(await b.opLog.latestSeq()).toBe(3);

    // Sequence numbers continue rather than restarting.
    await b.areas.upsert({ ...area, name: 'Health & Fitness' });
    const entries = await b.opLog.since(3);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.seq).toBe(4);
    expect(entries[0]?.op).toBe('update');
    await b.close();
  });

  it('can be deleted entirely', async () => {
    const factory = new IDBFactory();
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const a = await createIndexedDbRepository({
      name: 'orbit-del',
      clock,
      indexedDB: factory,
      IDBKeyRange,
    });
    await a.areas.upsert(createRecord(AreaSchema, clock, { name: 'X' }));
    await a.close();
    await deleteIndexedDb('orbit-del', { indexedDB: factory, IDBKeyRange });
    const b = await createIndexedDbRepository({
      name: 'orbit-del',
      clock,
      indexedDB: factory,
      IDBKeyRange,
    });
    expect(await b.areas.count()).toBe(0);
    await b.close();
  });
});
