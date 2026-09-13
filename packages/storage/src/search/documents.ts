import type { Area, Id, Note, Person, Project, Task } from '@orbit/core';
import type { Repository } from '../repository';
import type { SearchableType } from './types';

/**
 * What gets indexed for each searchable record. Both backends index exactly
 * these two strings per record, so a hit means the same thing on the web
 * (MiniSearch) and the desktop (FTS5):
 *
 * - task: title; body = project title · area name
 * - note: title; body = the note body
 * - project: title; body = outcome · area name
 * - person: name; body = contact
 *
 * The FTS5 triggers in `fts5.ts` express the same rule in SQL; the
 * `fts5 parity` test keeps the two definitions identical.
 */
export interface SearchDocument {
  id: Id;
  type: SearchableType;
  title: string;
  body: string;
  areaId: Id | null;
  updatedAt: string;
}

export interface SearchSnapshot {
  tasks: readonly Task[];
  notes: readonly Note[];
  projects: readonly Project[];
  people: readonly Person[];
  areas: readonly Area[];
}

export interface SearchLookups {
  areaNames: Map<Id, string>;
  projectTitles: Map<Id, string>;
}

export function lookupsFor(
  areas: Iterable<Pick<Area, 'id' | 'name' | 'deletedAt'>>,
  projects: Iterable<Pick<Project, 'id' | 'title' | 'deletedAt'>>,
): SearchLookups {
  const areaNames = new Map<Id, string>();
  for (const a of areas) if (a.deletedAt === null) areaNames.set(a.id, a.name);
  const projectTitles = new Map<Id, string>();
  for (const p of projects) if (p.deletedAt === null) projectTitles.set(p.id, p.title);
  return { areaNames, projectTitles };
}

const SEP = ' · ';

function joinParts(parts: Array<string | undefined | null>): string {
  return parts.filter((p): p is string => !!p && p.trim() !== '').join(SEP);
}

export function taskDocument(task: Task, lookups: SearchLookups): SearchDocument {
  return {
    id: task.id,
    type: 'task',
    title: task.title,
    body: joinParts([
      task.projectId ? lookups.projectTitles.get(task.projectId) : null,
      task.areaId ? lookups.areaNames.get(task.areaId) : null,
    ]),
    areaId: task.areaId,
    updatedAt: task.updatedAt,
  };
}

export function noteDocument(note: Note): SearchDocument {
  return {
    id: note.id,
    type: 'note',
    title: note.title,
    body: note.body,
    areaId: note.areaId,
    updatedAt: note.updatedAt,
  };
}

export function projectDocument(project: Project, lookups: SearchLookups): SearchDocument {
  return {
    id: project.id,
    type: 'project',
    title: project.title,
    body: joinParts([project.outcome, lookups.areaNames.get(project.areaId)]),
    areaId: project.areaId,
    updatedAt: project.updatedAt,
  };
}

export function personDocument(person: Person): SearchDocument {
  return {
    id: person.id,
    type: 'person',
    title: person.name,
    body: person.contact,
    areaId: null,
    updatedAt: person.updatedAt,
  };
}

/** Every live record as a document. Soft-deleted rows are never indexed. */
export function toSearchDocuments(snapshot: SearchSnapshot): SearchDocument[] {
  const lookups = lookupsFor(snapshot.areas, snapshot.projects);
  const live = <T extends { deletedAt: string | null }>(rows: readonly T[]) =>
    rows.filter((r) => r.deletedAt === null);
  return [
    ...live(snapshot.tasks).map((t) => taskDocument(t, lookups)),
    ...live(snapshot.notes).map(noteDocument),
    ...live(snapshot.projects).map((p) => projectDocument(p, lookups)),
    ...live(snapshot.people).map(personDocument),
  ];
}

export async function loadSearchSnapshot(repo: Repository): Promise<SearchSnapshot> {
  const [tasks, notes, projects, people, areas] = await Promise.all([
    repo.tasks.list(),
    repo.notes.list(),
    repo.projects.list(),
    repo.people.list(),
    repo.areas.list(),
  ]);
  return { tasks, notes, projects, people, areas };
}
