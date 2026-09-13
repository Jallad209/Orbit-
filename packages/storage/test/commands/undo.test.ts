import 'fake-indexeddb/auto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import {
  DayCommitmentSchema,
  TaskSchema,
  applyUndo,
  coreCommands,
  createCommandRegistry,
  createRecord,
  fixedClock,
} from '@orbit/core';
import type { CommandContext, FixedClock } from '@orbit/core';
import { createIndexedDbRepository } from '../../src/indexeddb';
import { createMemoryRepository } from '../../src/memory';
import type { Repository } from '../../src/repository';
import { createSqliteRepository } from '../../src/sqlite';
import { betterSqliteDriver } from '../betterSqliteDriver';

/**
 * The command undo model against every real adapter: a storage
 * `Repository` is a `CommandRepository`, the compensating op-log entry
 * carries `undoOf`, a stale undo is refused, and a refused undo writes
 * nothing because the whole entry is one transaction.
 */
const NOW = new Date(2026, 8, 14, 18, 0, 0);

const adapters: Array<[string, (clock: FixedClock) => Promise<Repository>]> = [
  ['memory', async (clock) => createMemoryRepository({ clock })],
  [
    'indexeddb',
    async (clock) =>
      createIndexedDbRepository({
        name: `orbit-undo-${Math.random()}`,
        clock,
        indexedDB: new IDBFactory(),
        IDBKeyRange,
      }),
  ],
  ['sqlite', async (clock) => createSqliteRepository({ driver: betterSqliteDriver(), clock })],
];

function contextFor(repo: Repository, clock: FixedClock): CommandContext {
  return {
    repo,
    clock,
    navigate: vi.fn(),
    notify: vi.fn(),
    capabilities: { insights: false, weeklyReview: false },
    settings: { defaultEstimateMin: 30 },
  };
}

describe.each(adapters)('undo on %s', (_name, open) => {
  it('reverses add-task, appends a compensating op with undoOf, and survives a stale conflict', async () => {
    const clock = fixedClock(NOW);
    const repo = await open(clock);
    const registry = createCommandRegistry({ commands: coreCommands() });
    const ctx = contextFor(repo, clock);

    const created = await registry.run('add-task', ctx, { text: 'Water the plants' });
    if (!created.ok) throw new Error(created.message);
    const [task] = await repo.tasks.list();
    expect(task?.title).toBe('Water the plants');

    clock.advance(1000);
    const undone = await registry.run('undo', ctx);
    expect(undone).toMatchObject({ ok: true, outcome: { message: 'Undid: Add task' } });
    expect(await repo.tasks.list()).toEqual([]);
    const [last] = (await repo.opLog.since(0)).slice(-1);
    expect(last).toMatchObject({
      entity: 'task',
      entityId: task!.id,
      op: 'delete',
      patch: { undoOf: created.undoId },
    });

    // A second actor edits a fresh task between the command and its undo.
    const again = await registry.run('add-task', ctx, { text: 'Call the bank' });
    if (!again.ok) throw new Error(again.message);
    const [fresh] = await repo.tasks.list();
    clock.advance(1000);
    await repo.tasks.upsert({ ...fresh!, title: 'Call the bank (edited elsewhere)' });
    const seqBefore = await repo.opLog.latestSeq();
    const stale = await registry.run('undo', ctx);
    expect(stale).toMatchObject({ ok: false, kind: 'failed' });
    expect((stale as { message: string }).message).toContain('changed since');
    expect((await repo.tasks.get(fresh!.id))?.title).toBe('Call the bank (edited elsewhere)');
    expect(await repo.opLog.latestSeq()).toBe(seqBefore);
    await repo.close();
  });

  it('restores the previous record after a reschedule and rolls back atomically on conflict', async () => {
    const clock = fixedClock(NOW);
    const repo = await open(clock);
    const registry = createCommandRegistry({ commands: coreCommands() });
    const ctx = contextFor(repo, clock);
    const a = await repo.tasks.upsert(
      createRecord(TaskSchema, clock, { title: 'A', status: 'open', priority: 1 }),
    );
    const b = await repo.tasks.upsert(
      createRecord(TaskSchema, clock, { title: 'B', status: 'open', priority: 1 }),
    );
    await repo.dayCommitments.upsert(
      createRecord(DayCommitmentSchema, clock, {
        date: '2026-09-14',
        acceptedTaskIds: [a.id, b.id],
        acceptedAt: clock.now().toISOString(),
      }),
    );
    clock.advance(1000);
    const moved = await registry.run('reschedule-unfinished', ctx, { target: 'tomorrow' });
    if (!moved.ok) throw new Error(moved.message);
    expect((await repo.tasks.get(a.id))!.dueAt!.slice(0, 10)).toBe('2026-09-15');
    const entry = registry.undo.peek()!;

    // One of the two moved since: nothing is restored.
    clock.advance(1000);
    await repo.tasks.upsert({ ...(await repo.tasks.get(b.id))!, title: 'B touched' });
    const seqBefore = await repo.opLog.latestSeq();
    await expect(applyUndo(repo, entry)).rejects.toThrow('changed since');
    expect((await repo.tasks.get(a.id))!.dueAt!.slice(0, 10)).toBe('2026-09-15');
    expect(await repo.opLog.latestSeq()).toBe(seqBefore);

    // Put b back as the command left it, and the undo goes through.
    const afterB = entry.changes.find((c) => c.entityId === b.id)!.after;
    await repo.tasks.upsert(afterB as typeof b, { preserveUpdatedAt: true });
    clock.advance(1000);
    await applyUndo(repo, entry);
    expect((await repo.tasks.get(a.id))!.dueAt).toBeNull();
    expect((await repo.tasks.get(b.id))!.dueAt).toBeNull();
    const ops = await repo.opLog.since(seqBefore);
    expect(ops.slice(-2).every((o) => o.patch.undoOf === entry.id)).toBe(true);
    await repo.close();
  });
});
