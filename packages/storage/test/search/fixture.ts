import {
  AreaSchema,
  NoteSchema,
  PersonSchema,
  ProjectSchema,
  TaskSchema,
  createRecord,
} from '@orbit/core';
import type { Area, FixedClock, Note, Person, Project, Task } from '@orbit/core';
import type { Repository } from '../../src/repository';

/**
 * A small mixed world every search test shares: a "university" note, a
 * similarly titled task, an area named University, a person, a project, a
 * soft-deleted task that must never surface, and an accented title.
 */
export interface SearchWorld {
  university: Area;
  home: Area;
  thesis: Project;
  readingList: Note;
  cafeNotes: Note;
  fees: Task;
  groceries: Task;
  parking: Task;
  omar: Person;
}

export async function seedSearchWorld(repo: Repository, clock: FixedClock): Promise<SearchWorld> {
  const university = createRecord(AreaSchema, clock, { name: 'University' });
  const home = createRecord(AreaSchema, clock, { name: 'Home' });
  const thesis = createRecord(ProjectSchema, clock, {
    title: 'Thesis',
    areaId: university.id,
    outcome: 'Submit the thesis by June',
  });
  const readingList = createRecord(NoteSchema, clock, {
    title: 'University reading list',
    body: 'Chapters on neural networks and the thesis timeline.\nMeet Omar about the lab.',
    projectId: thesis.id,
    areaId: university.id,
  });
  const cafeNotes = createRecord(NoteSchema, clock, {
    title: 'Café notes',
    body: 'Thoughts on neural networks.',
  });
  const fees = createRecord(TaskSchema, clock, {
    title: 'University fees',
    status: 'open',
    projectId: thesis.id,
    areaId: university.id,
  });
  const groceries = createRecord(TaskSchema, clock, {
    title: 'Buy groceries',
    status: 'open',
    areaId: home.id,
  });
  const parking = createRecord(TaskSchema, clock, { title: 'University parking', status: 'open' });
  const omar = createRecord(PersonSchema, clock, {
    name: 'Omar Haddad',
    contact: 'omar@example.com',
  });

  await repo.areas.upsert(university);
  await repo.areas.upsert(home);
  await repo.projects.upsert(thesis);
  await repo.notes.upsert(readingList);
  await repo.notes.upsert(cafeNotes);
  await repo.tasks.upsert(fees);
  await repo.tasks.upsert(groceries);
  await repo.tasks.upsert(parking);
  await repo.tasks.softDelete(parking.id);
  await repo.people.upsert(omar);

  return { university, home, thesis, readingList, cafeNotes, fees, groceries, parking, omar };
}
