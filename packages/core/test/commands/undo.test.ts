import { describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../../src/clock';
import {
  UNDO_LIMIT,
  applyUndo,
  coreCommands,
  createCommandRegistry,
  createUndoStack,
} from '../../src/commands';
import type { CommandContext } from '../../src/commands';
import { createRecord } from '../../src/records';
import { DayCommitmentSchema, TaskSchema } from '../../src/schema';
import { fakeRepository } from './fakeRepository';

const NOW = new Date(2026, 8, 14, 18, 0, 0);

function setup() {
  const clock = fixedClock(NOW);
  const repo = fakeRepository(clock);
  const registry = createCommandRegistry({ commands: coreCommands() });
  const ctx: CommandContext = {
    repo,
    clock,
    navigate: vi.fn(),
    notify: vi.fn(),
    capabilities: { insights: false, weeklyReview: false },
    settings: { defaultEstimateMin: 30 },
  };
  return { clock, repo, registry, ctx };
}

describe('undo stack', () => {
  it('keeps the last 20 entries only', () => {
    const stack = createUndoStack();
    const clock = fixedClock(NOW);
    for (let i = 0; i < UNDO_LIMIT + 5; i += 1) {
      stack.push({ commandId: 'x', title: `Entry ${i}`, changes: [] }, clock);
    }
    expect(stack.size).toBe(UNDO_LIMIT);
    expect(stack.peek()?.title).toBe(`Entry ${UNDO_LIMIT + 4}`);
  });

  it('notifies subscribers and says when there is nothing to undo', async () => {
    const stack = createUndoStack();
    const listener = vi.fn();
    const off = stack.subscribe(listener);
    const { repo } = setup();
    expect(await stack.undoLast(repo)).toEqual({
      ok: false,
      reason: 'empty',
      message: 'Nothing to undo.',
    });
    stack.push({ commandId: 'x', title: 'Entry', changes: [] }, fixedClock(NOW));
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    stack.clear();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(stack.size).toBe(0);
  });
});

describe('undoing commands', () => {
  it('reverses a created task by soft-deleting it and appends a compensating op', async () => {
    const { repo, registry, ctx, clock } = setup();
    const created = await registry.run('add-task', ctx, { text: 'Water the plants' });
    if (!created.ok) throw new Error(created.message);
    const [task] = await repo.tasks.list();
    clock.advance(60_000);

    const result = await registry.run('undo', ctx);
    expect(result).toMatchObject({ ok: true, outcome: { message: 'Undid: Add task' } });
    expect(await repo.tasks.list()).toEqual([]);
    expect((await repo.tasks.get(task!.id))?.deletedAt).toBe(clock.now().toISOString());
    const last = repo.ops().at(-1)!;
    expect(last).toMatchObject({
      entity: 'tasks',
      entityId: task!.id,
      op: 'delete',
      patch: { undoOf: created.undoId },
    });
    expect(registry.undo.size).toBe(0);
    expect(registry.list(ctx).map((c) => c.id)).not.toContain('undo');
  });

  it('restores the exact previous record after a reschedule', async () => {
    const { repo, registry, ctx, clock } = setup();
    const task = createRecord(TaskSchema, clock, {
      title: 'Urgent',
      status: 'open',
      priority: 1,
      dueAt: new Date(2026, 8, 14, 17, 0).toISOString(),
      notes: 'keep these notes',
    });
    await repo.tasks.upsert(task);
    await repo.dayCommitments.upsert(
      createRecord(DayCommitmentSchema, clock, {
        date: '2026-09-14',
        acceptedTaskIds: [task.id],
        acceptedAt: clock.now().toISOString(),
      }),
    );
    const before = (await repo.tasks.get(task.id))!;
    clock.advance(1000);
    const moved = await registry.run('reschedule-unfinished', ctx, { target: 'tomorrow' });
    if (!moved.ok) throw new Error(moved.message);
    expect((await repo.tasks.get(task.id))!.dueAt!.slice(0, 10)).toBe('2026-09-15');

    clock.advance(1000);
    const undone = await registry.undoLast(ctx);
    expect(undone.ok).toBe(true);
    const restored = (await repo.tasks.get(task.id))!;
    expect(restored).toEqual({ ...before, updatedAt: clock.now().toISOString() });
    expect(repo.ops().at(-1)).toMatchObject({
      op: 'update',
      patch: { dueAt: before.dueAt, undoOf: moved.undoId },
    });
  });

  it('refuses a stale undo and leaves the newer record untouched', async () => {
    const { repo, registry, ctx, clock } = setup();
    const created = await registry.run('add-task', ctx, { text: 'Draft the memo' });
    if (!created.ok) throw new Error(created.message);
    const [task] = await repo.tasks.list();

    // Another window edits the task before we undo.
    clock.advance(5000);
    await repo.tasks.upsert({ ...task!, title: 'Draft the memo (edited elsewhere)' });
    const opsBefore = repo.ops().length;

    const result = await registry.run('undo', ctx);
    expect(result).toEqual({
      ok: false,
      kind: 'failed',
      message: '“Add task” was not undone: the task changed since (maybe in another window).',
    });
    expect((await repo.tasks.get(task!.id))?.title).toBe('Draft the memo (edited elsewhere)');
    expect(repo.ops().length).toBe(opsBefore);
    expect(registry.undo.size).toBe(0);
  });

  it('is atomic: one stale record in an entry means nothing is written', async () => {
    const { repo, ctx, clock } = setup();
    const a = await repo.tasks.upsert(
      createRecord(TaskSchema, clock, { title: 'A', status: 'open' }),
    );
    const b = await repo.tasks.upsert(
      createRecord(TaskSchema, clock, { title: 'B', status: 'open' }),
    );
    clock.advance(1000);
    const a2 = await repo.tasks.upsert({ ...a, title: 'A2' });
    const b2 = await repo.tasks.upsert({ ...b, title: 'B2' });
    clock.advance(1000);
    const b3 = await repo.tasks.upsert({ ...b2, title: 'B3' }); // moved since the command
    const entry = {
      id: '00000000-0000-7000-8000-000000000009',
      commandId: 'x',
      title: 'Rename',
      at: clock.now().toISOString(),
      changes: [
        { entity: 'task' as const, entityId: a.id, before: a, after: a2 },
        { entity: 'task' as const, entityId: b.id, before: b, after: b2 },
      ],
    };
    const opsBefore = repo.ops().length;
    await expect(applyUndo(ctx.repo, entry)).rejects.toThrow('changed since');
    expect((await repo.tasks.get(a.id))?.title).toBe('A2');
    expect((await repo.tasks.get(b.id))?.title).toBe(b3.title);
    expect(repo.ops().length).toBe(opsBefore);
  });
});
