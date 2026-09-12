import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AreaSchema,
  LinkSchema,
  ProjectSchema,
  TaskSchema,
  createRecord,
  fixedClock,
} from '@orbit/core';
import type { FixedClock } from '@orbit/core';
import type { Repository } from '../src/repository';

export interface ContractFactory {
  /** Open a fresh, empty repository driven by `clock`. */
  open(clock: FixedClock): Promise<Repository>;
}

/**
 * Behavioural contract every Repository adapter must satisfy. Adapters call
 * `repositoryContract('sqlite', { open })` from their own test file.
 */
export function repositoryContract(name: string, factory: ContractFactory): void {
  describe(`Repository contract: ${name}`, () => {
    let clock: FixedClock;
    let repo: Repository;

    beforeEach(async () => {
      clock = fixedClock('2026-09-12T09:00:00.000Z');
      repo = await factory.open(clock);
    });

    afterEach(async () => {
      await repo.close();
    });

    it('upsert then get returns the record', async () => {
      const area = createRecord(AreaSchema, clock, { name: 'Health' });
      await repo.areas.upsert(area);
      const found = await repo.areas.get(area.id);
      expect(found).toEqual(area);
      expect(await repo.areas.get('00000000-0000-7000-8000-000000000000')).toBeUndefined();
    });

    it('upsert on an existing id replaces it and bumps updatedAt', async () => {
      const task = createRecord(TaskSchema, clock, { title: 'Draft' });
      await repo.tasks.upsert(task);
      clock.advance(60_000);
      await repo.tasks.upsert({ ...task, title: 'Draft v2', status: 'open' });
      const found = await repo.tasks.get(task.id);
      expect(found?.title).toBe('Draft v2');
      expect(found?.status).toBe('open');
      expect(found?.createdAt).toBe(task.createdAt);
      expect(found?.updatedAt).toBe('2026-09-12T09:01:00.000Z');
      expect(await repo.tasks.count()).toBe(1);
    });

    it('rejects a record that violates the schema', async () => {
      const task = createRecord(TaskSchema, clock, { title: 'ok' });
      await expect(repo.tasks.upsert({ ...task, title: '' })).rejects.toThrow();
      expect(await repo.tasks.count()).toBe(0);
    });

    it('soft delete hides from list but keeps the row', async () => {
      const a = createRecord(AreaSchema, clock, { name: 'A' });
      const b = createRecord(AreaSchema, clock, { name: 'B' });
      await repo.areas.upsert(a);
      await repo.areas.upsert(b);
      clock.advance(1000);
      await repo.areas.softDelete(a.id);

      const live = await repo.areas.list();
      expect(live.map((r) => r.id)).toEqual([b.id]);

      const all = await repo.areas.list({ includeDeleted: true });
      expect(all).toHaveLength(2);

      const kept = await repo.areas.get(a.id);
      expect(kept?.deletedAt).toBe('2026-09-12T09:00:01.000Z');
      expect(await repo.areas.count()).toBe(1);
      expect(await repo.areas.count({ includeDeleted: true })).toBe(2);
    });

    it('soft delete is idempotent and unknown ids are a no-op', async () => {
      const a = createRecord(AreaSchema, clock, { name: 'A' });
      await repo.areas.upsert(a);
      await repo.areas.softDelete(a.id);
      await repo.areas.softDelete(a.id);
      await repo.areas.softDelete('00000000-0000-7000-8000-000000000000');
      expect(await repo.opLog.latestSeq()).toBe(2); // create + one delete
    });

    it('query and getMany filter correctly', async () => {
      const t1 = createRecord(TaskSchema, clock, { title: 'one', status: 'open' });
      const t2 = createRecord(TaskSchema, clock, { title: 'two', status: 'done' });
      const t3 = createRecord(TaskSchema, clock, { title: 'three', status: 'open' });
      for (const t of [t1, t2, t3]) await repo.tasks.upsert(t);

      const open = await repo.tasks.query((t) => t.status === 'open');
      expect(open.map((t) => t.title).sort()).toEqual(['one', 'three']);

      const some = await repo.tasks.getMany([t2.id, t3.id, '00000000-0000-7000-8000-000000000000']);
      expect(some.map((t) => t.id).sort()).toEqual([t2.id, t3.id].sort());
    });

    it('op log receives one entry per mutation, in order', async () => {
      const task = createRecord(TaskSchema, clock, { title: 'Draft' });
      await repo.tasks.upsert(task);
      clock.advance(1000);
      await repo.tasks.upsert({ ...task, title: 'Draft v2' });
      clock.advance(1000);
      await repo.tasks.softDelete(task.id);

      const entries = await repo.opLog.since(0);
      expect(entries.map((e) => e.op)).toEqual(['create', 'update', 'delete']);
      expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
      expect(entries.every((e) => e.entity === 'task' && e.entityId === task.id)).toBe(true);
      expect(entries[1]?.patch).toEqual({
        title: 'Draft v2',
        updatedAt: '2026-09-12T09:00:01.000Z',
      });
      expect(entries[2]?.patch).toEqual({ deletedAt: '2026-09-12T09:00:02.000Z' });

      expect(await repo.opLog.since(2)).toHaveLength(1);
      expect(await repo.opLog.since(0, 2)).toHaveLength(2);
      expect(await repo.opLog.latestSeq()).toBe(3);
    });

    it('transaction commits on success', async () => {
      const area = createRecord(AreaSchema, clock, { name: 'Study' });
      const project = createRecord(ProjectSchema, clock, { title: 'Thesis', areaId: area.id });
      const result = await repo.transaction(async (tx) => {
        await tx.areas.upsert(area);
        await tx.projects.upsert(project);
        return 'ok';
      });
      expect(result).toBe('ok');
      expect(await repo.areas.count()).toBe(1);
      expect(await repo.projects.count()).toBe(1);
      expect(await repo.opLog.latestSeq()).toBe(2);
    });

    it('transaction rolls back on throw, including op-log entries', async () => {
      const before = createRecord(AreaSchema, clock, { name: 'Before' });
      await repo.areas.upsert(before);

      const area = createRecord(AreaSchema, clock, { name: 'Study' });
      await expect(
        repo.transaction(async (tx) => {
          await tx.areas.upsert(area);
          await tx.areas.softDelete(before.id);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      expect(await repo.areas.get(area.id)).toBeUndefined();
      expect((await repo.areas.get(before.id))?.deletedAt).toBeNull();
      expect(await repo.opLog.latestSeq()).toBe(1);
    });

    it('nested transactions join the outer one', async () => {
      const area = createRecord(AreaSchema, clock, { name: 'Outer' });
      const inner = createRecord(AreaSchema, clock, { name: 'Inner' });
      await expect(
        repo.transaction(async (tx) => {
          await tx.areas.upsert(area);
          await tx.transaction(async (tx2) => {
            await tx2.areas.upsert(inner);
          });
          throw new Error('outer failed');
        }),
      ).rejects.toThrow('outer failed');
      expect(await repo.areas.count()).toBe(0);
    });

    it('links can be listed from either side', async () => {
      const task = createRecord(TaskSchema, clock, { title: 'T' });
      const note = createRecord(TaskSchema, clock, { title: 'N' });
      await repo.tasks.upsert(task);
      await repo.tasks.upsert(note);
      const link = createRecord(LinkSchema, clock, {
        fromType: 'task',
        fromId: task.id,
        toType: 'note',
        toId: note.id,
        linkType: 'related',
      });
      await repo.links.upsert(link);

      expect(await repo.links.forEntity('task', task.id)).toEqual([link]);
      expect(await repo.links.forEntity('note', note.id)).toEqual([link]);
      expect(await repo.links.forEntity('project', task.id)).toEqual([]);

      await repo.links.softDelete(link.id);
      expect(await repo.links.forEntity('task', task.id)).toEqual([]);
    });
  });
}
