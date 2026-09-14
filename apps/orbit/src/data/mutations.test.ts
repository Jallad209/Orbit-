import { describe, expect, it } from 'vitest';
import { NoteSchema, createRecord, fixedClock } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { useAppStore } from '@/app/store';
import { ConflictError, currentRecord, mergePatch, mutate } from './mutations';

const clock = fixedClock('2026-09-12T09:00:00.000Z');

describe('shared mutation boundary', () => {
  it('re-reads the current row and refuses missing, deleted, and changed records', async () => {
    const repo = createMemoryRepository({ clock });
    const note = await repo.notes.upsert(createRecord(NoteSchema, clock, { title: 'A' }));
    expect(await currentRecord(repo.notes, note, { noun: 'note' })).toEqual(note);
    await expect(
      currentRecord(repo.notes, { id: '00000000-0000-7000-8000-000000000001' }),
    ).rejects.toMatchObject({ code: 'missing' });
    clock.advance(1000);
    const edited = await repo.notes.upsert({ ...note, title: 'B' });
    await expect(currentRecord(repo.notes, note, { noun: 'note' })).rejects.toMatchObject({
      code: 'changed',
      message: 'This note changed since you opened it.',
    });
    expect(await currentRecord(repo.notes, { id: note.id })).toEqual(edited);
    await repo.notes.softDelete(note.id);
    await expect(currentRecord(repo.notes, { id: note.id })).rejects.toMatchObject({
      code: 'deleted',
    });
    expect(
      (await currentRecord(repo.notes, { id: note.id }, { allowDeleted: true })).deletedAt,
    ).not.toBeNull();
  });

  it('merges independent field edits and refuses a patched field that changed underneath', () => {
    const base = createRecord(NoteSchema, clock, { title: 'A', body: 'one' });
    // Someone else changed the title; the user changed the body: both survive.
    const current = { ...base, title: 'Renamed', updatedAt: '2026-09-12T09:01:00.000Z' };
    expect(mergePatch(current, base, { body: 'two' })).toMatchObject({
      title: 'Renamed',
      body: 'two',
    });
    // Same-millisecond writes: identical stamp, different body — still a conflict.
    const raced = { ...base, body: 'theirs' };
    expect(() => mergePatch(raced, base, { body: 'mine' })).toThrow(ConflictError);
    try {
      mergePatch(raced, base, { body: 'mine' });
    } catch (e) {
      expect((e as ConflictError).fields).toEqual(['body']);
    }
    // Setting the same value they set is not a conflict.
    expect(mergePatch(raced, base, { body: 'theirs' }).body).toBe('theirs');
    expect(mergePatch(current, base, { body: undefined }).body).toBe('one');
  });

  it('bumps the data version only after a committed transaction', async () => {
    const repo = createMemoryRepository({ clock });
    const before = useAppStore.getState().dataVersion;
    await expect(
      mutate(repo, async (tx) => {
        await tx.notes.upsert(createRecord(NoteSchema, clock, { title: 'A' }));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(useAppStore.getState().dataVersion).toBe(before);
    expect(await repo.notes.count()).toBe(0);
    await mutate(repo, async (tx) =>
      tx.notes.upsert(createRecord(NoteSchema, clock, { title: 'B' })),
    );
    expect(useAppStore.getState().dataVersion).toBe(before + 1);
    expect(await repo.notes.count()).toBe(1);
  });
});
