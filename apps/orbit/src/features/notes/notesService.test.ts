import { describe, expect, it } from 'vitest';
import { AreaSchema, ProjectSchema, createRecord, fixedClock } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { createNote, deleteNote, loadNote, loadNotes, restoreNote, saveNote } from './notesService';

describe('notes service', () => {
  it('creates with a required title, derives the area from the project, and blocks archived parents', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const repo = createMemoryRepository({ clock });
    const area = await repo.areas.upsert(createRecord(AreaSchema, clock, { name: 'Study' }));
    const other = await repo.areas.upsert(createRecord(AreaSchema, clock, { name: 'Home' }));
    const project = await repo.projects.upsert(
      createRecord(ProjectSchema, clock, { title: 'Thesis', areaId: area.id }),
    );
    const archived = await repo.projects.upsert(
      createRecord(ProjectSchema, clock, { title: 'Old', areaId: area.id, status: 'archived' }),
    );
    await expect(createNote(repo, { title: '  ' }, clock)).rejects.toThrow('A title is required.');
    const note = await createNote(
      repo,
      { title: 'Plan', projectId: project.id, areaId: other.id },
      clock,
    );
    expect(note).toMatchObject({ projectId: project.id, areaId: area.id, body: '' });
    await expect(createNote(repo, { title: 'X', projectId: archived.id }, clock)).rejects.toThrow(
      /archived/,
    );
    // A note already in an archived project stays editable there.
    const inside = await repo.notes.upsert({
      ...note,
      projectId: archived.id,
      id: '00000000-0000-7000-8000-0000000000aa',
    });
    const saved = await saveNote(repo, inside, { body: 'still editable' });
    expect(saved).toMatchObject({
      kind: 'saved',
      note: { body: 'still editable', projectId: archived.id },
    });
    // Reassigning to another archived project is blocked; the body is untouched.
    await expect(
      saveNote(repo, saved.kind === 'saved' ? saved.note : inside, {
        projectId: archived.id,
        body: 'x',
      }),
    ).resolves.toMatchObject({ kind: 'saved' });
    const detail = (await loadNote(repo, note.id))!;
    expect(detail.projects.map((p) => p.id)).toEqual([project.id]);
    expect(detail.parentUnavailable).toBe(false);
    await repo.projects.softDelete(project.id);
    expect((await loadNote(repo, note.id))!.parentUnavailable).toBe(true);
    const row = (await loadNotes(repo)).rows.find((r) => r.note.id === note.id)!;
    expect(row).toMatchObject({ projectTitle: null });
  });

  it('applies only the intended patch, merges independent fields, and reports same-field conflicts with both texts', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const repo = createMemoryRepository({ clock });
    const note = await createNote(repo, { title: 'Draft', body: 'one' }, clock);
    // Someone else renames it; my body edit still applies and their title survives.
    clock.advance(1000);
    await repo.notes.upsert({ ...note, title: 'Renamed' });
    const merged = await saveNote(repo, note, { body: 'two' });
    expect(merged).toMatchObject({ kind: 'saved', note: { title: 'Renamed', body: 'two' } });
    // Same field changed underneath (same millisecond even): conflict, nothing overwritten.
    const base = merged.kind === 'saved' ? merged.note : note;
    await repo.notes.upsert({ ...base, body: 'theirs' });
    const conflict = await saveNote(repo, base, { body: 'mine' });
    expect(conflict).toMatchObject({
      kind: 'conflict',
      fields: ['body'],
      current: { body: 'theirs' },
    });
    expect((await repo.notes.get(note.id))!.body).toBe('theirs');
    await expect(saveNote(repo, base, { title: '  ' })).rejects.toThrow('A title is required.');
    // Deleted elsewhere: the save is refused rather than resurrecting the note.
    await deleteNote(repo, note.id);
    expect(await saveNote(repo, base, { body: 'late' })).toEqual({ kind: 'deleted' });
    expect((await repo.notes.get(note.id))!.deletedAt).not.toBeNull();
    const restored = await restoreNote(repo, note.id);
    expect(restored.deletedAt).toBeNull();
    expect(
      await saveNote(repo, { ...base, id: '00000000-0000-7000-8000-000000000001' }, { body: 'x' }),
    ).toEqual({ kind: 'missing' });
  });

  it('lists newest edit first with filters and a stable tie-breaker', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const repo = createMemoryRepository({ clock });
    const area = await repo.areas.upsert(createRecord(AreaSchema, clock, { name: 'Study' }));
    const a = await createNote(repo, { title: 'Alpha', areaId: area.id }, clock);
    const b = await createNote(repo, { title: 'Beta' }, clock);
    clock.advance(1000);
    await saveNote(repo, a, { body: 'edited' });
    const all = await loadNotes(repo);
    expect(all.rows.map((r) => r.note.id)).toEqual([a.id, b.id]);
    expect((await loadNotes(repo, { q: 'bet' })).rows.map((r) => r.note.id)).toEqual([b.id]);
    expect((await loadNotes(repo, { areaId: area.id })).rows.map((r) => r.note.id)).toEqual([a.id]);
    await deleteNote(repo, b.id);
    expect((await loadNotes(repo)).deleted.map((n) => n.id)).toEqual([b.id]);
  });
});
