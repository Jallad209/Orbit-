import { NoteSchema, createRecord, resolveNoteParent, systemClock } from '@orbit/core';
import type { Area, Clock, Id, Note, Project } from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { ConflictError, currentRecord, mergePatch, mutate } from '@/data/mutations';

/**
 * Notes (week 12). The editor saves patches, never whole records: a save
 * carries the note id, the base the user edited from, and only the
 * fields that changed, so an edit elsewhere to a different field merges
 * and an edit to the same field is a conflict that keeps both texts. The
 * body is stored losslessly; preview never rewrites it.
 */

export interface NoteFilters {
  q?: string;
  areaId?: Id;
  projectId?: Id;
}

export interface NoteRow {
  note: Note;
  projectTitle: string | null;
  areaName: string | null;
}

export interface NotesList {
  rows: NoteRow[];
  areas: Area[];
  projects: Project[];
  deleted: Note[];
}

/** Newest updated first, with an id tie-breaker; filters on title, area, and project. */
export async function loadNotes(repo: Repository, filters: NoteFilters = {}): Promise<NotesList> {
  const [notes, areas, projects] = await Promise.all([
    repo.notes.list({ includeDeleted: true }),
    repo.areas.list(),
    repo.projects.list(),
  ]);
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const q = filters.q?.trim().toLowerCase() ?? '';
  const live = notes
    .filter((n) => n.deletedAt === null)
    .filter((n) => !q || n.title.toLowerCase().includes(q))
    .filter((n) => !filters.areaId || n.areaId === filters.areaId)
    .filter((n) => !filters.projectId || n.projectId === filters.projectId)
    .sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1,
    );
  return {
    rows: live.map((note) => ({
      note,
      projectTitle: note.projectId ? (projectById.get(note.projectId)?.title ?? null) : null,
      areaName: note.areaId ? (areaById.get(note.areaId)?.name ?? null) : null,
    })),
    areas: areas.sort((a, b) => a.name.localeCompare(b.name)),
    projects: projects.sort((a, b) => a.title.localeCompare(b.title)),
    deleted: notes.filter((n) => n.deletedAt !== null),
  };
}

export interface NoteDetail {
  note: Note;
  areas: Area[];
  /** Live projects the note may be assigned to (archived ones only when already the parent). */
  projects: Project[];
  /** The parent project is missing or deleted: shown as unavailable, the body untouched. */
  parentUnavailable: boolean;
}

export async function loadNote(repo: Repository, id: Id): Promise<NoteDetail | null> {
  const note = await repo.notes.get(id);
  if (!note) return null;
  const [areas, projects] = await Promise.all([repo.areas.list(), repo.projects.list()]);
  const parent = note.projectId ? projects.find((p) => p.id === note.projectId) : undefined;
  return {
    note,
    areas: areas.sort((a, b) => a.name.localeCompare(b.name)),
    projects: projects
      .filter((p) => p.status !== 'archived' || p.id === note.projectId)
      .sort((a, b) => a.title.localeCompare(b.title)),
    parentUnavailable: note.projectId !== null && !parent,
  };
}

export async function createNote(
  repo: Repository,
  fields: { title: string; body?: string; projectId?: Id | null; areaId?: Id | null },
  clock: Clock = systemClock,
): Promise<Note> {
  const title = fields.title.trim();
  if (!title) throw new Error('A title is required.');
  return mutate(repo, async (tx) => {
    const [areas, projects] = await Promise.all([tx.areas.list(), tx.projects.list()]);
    const parent = resolveNoteParent(
      { projectId: fields.projectId ?? null, areaId: fields.areaId ?? null },
      { areas, goals: [], projects, tasks: [] },
    );
    return tx.notes.upsert(
      createRecord(NoteSchema, clock, { title, body: fields.body ?? '', ...parent }),
    );
  });
}

export type NotePatch = Partial<Pick<Note, 'title' | 'body' | 'projectId' | 'areaId'>>;

export type SaveOutcome =
  | { kind: 'saved'; note: Note }
  /** Someone else changed a field the user also changed; both versions are kept. */
  | { kind: 'conflict'; current: Note; fields: string[] }
  /** The note was deleted elsewhere; the draft is kept for copying. */
  | { kind: 'deleted' }
  | { kind: 'missing' };

/**
 * Save a patch against the base the editor loaded. Independent fields
 * merge; a same-field change underneath is reported with the current
 * record so the editor can offer reload, copy, or save as new. An empty
 * title never saves. The parent policy runs on any assignment change.
 */
export async function saveNote(
  repo: Repository,
  base: Note,
  patch: NotePatch,
): Promise<SaveOutcome> {
  if (patch.title !== undefined && !patch.title.trim()) throw new Error('A title is required.');
  try {
    const note = await mutate(repo, async (tx) => {
      const current = await currentRecord(tx.notes, { id: base.id }, { noun: 'note' });
      let merged = mergePatch<Note>(current, base, patch);
      if (patch.projectId !== undefined || patch.areaId !== undefined) {
        const [areas, projects] = await Promise.all([tx.areas.list(), tx.projects.list()]);
        merged = resolveNoteParent(
          merged,
          { areas, goals: [], projects, tasks: [] },
          { previousProjectId: current.projectId },
        );
      }
      if (patch.title !== undefined) merged = { ...merged, title: merged.title.trim() };
      return tx.notes.upsert(merged);
    });
    return { kind: 'saved', note };
  } catch (e) {
    if (e instanceof ConflictError) {
      if (e.code === 'deleted') return { kind: 'deleted' };
      if (e.code === 'missing') return { kind: 'missing' };
      const current = await repo.notes.get(base.id);
      if (current) return { kind: 'conflict', current, fields: e.fields };
      return { kind: 'missing' };
    }
    throw e;
  }
}

export async function deleteNote(repo: Repository, noteId: Id): Promise<void> {
  await mutate(repo, async (tx) => {
    await currentRecord(tx.notes, { id: noteId }, { noun: 'note' });
    await tx.notes.softDelete(noteId);
  });
}

/** Restore a deleted note; its relationship records were kept, so the linked panel fills again. */
export async function restoreNote(repo: Repository, noteId: Id): Promise<Note> {
  return mutate(repo, async (tx) => {
    const current = await currentRecord(
      tx.notes,
      { id: noteId },
      { noun: 'note', allowDeleted: true },
    );
    if (current.deletedAt === null) return current;
    return tx.notes.upsert({ ...current, deletedAt: null });
  });
}

export { ConflictError };
