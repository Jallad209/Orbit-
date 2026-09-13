import type { Clock } from '../clock';
import { addDays, toInstant, toLocalDate } from '../dates';
import { createRecord } from '../records';
import {
  BillSchema,
  CommitmentSchema,
  EventSchema,
  GoalSchema,
  NoteSchema,
  PersonSchema,
  RoutineSchema,
  TaskSchema,
} from '../schema';
import type {
  Bill,
  Commitment,
  EntityType,
  Event,
  Goal,
  Id,
  Note,
  Person,
  Routine,
  Task,
} from '../schema';
import type { CaptureFields, CaptureType } from './types';

export type MaterializedRecord =
  | { store: 'tasks'; record: Task }
  | { store: 'events'; record: Event }
  | { store: 'notes'; record: Note }
  | { store: 'goals'; record: Goal }
  | { store: 'routines'; record: Routine }
  | { store: 'bills'; record: Bill }
  | { store: 'people'; record: Person }
  | { store: 'commitments'; record: Commitment };

export interface Materialized {
  /** Records to persist, in order. */
  records: MaterializedRecord[];
  /** The entity the capture "became". */
  primary: { type: EntityType; id: Id };
}

export interface MaterializeOptions {
  /** Used only when the capture did not include an explicit task estimate. */
  defaultEstimateMin?: number;
  /** Required for goals; optional parent for tasks, notes, routines. */
  areaId?: Id | null;
  /** Optional parent for tasks and notes. */
  projectId?: Id | null;
  /** Existing people, so a commitment links instead of duplicating. */
  people?: readonly Person[];
}

export type MaterializeErrorCode = 'needs-area' | 'needs-person';

export class MaterializeError extends Error {
  constructor(
    public readonly code: MaterializeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MaterializeError';
  }
}

const END_OF_DAY = 23 * 60 + 59;

function instant(date: string, minute: number): string {
  return toInstant(date, minute).toISOString();
}

/**
 * Turn a classified capture into concrete records. Pure: returns what to
 * write, the caller persists it in one transaction. Fills sensible defaults
 * where the parser found nothing (an event without a time starts at 09:00).
 */
export function materializeCapture(
  type: CaptureType,
  fields: CaptureFields,
  clock: Clock,
  options: MaterializeOptions = {},
): Materialized {
  const today = toLocalDate(clock.now());
  const areaId = options.areaId ?? null;
  const projectId = options.projectId ?? null;

  switch (type) {
    case 'task': {
      const task = createRecord(TaskSchema, clock, {
        title: fields.title,
        status: 'open',
        projectId,
        areaId,
        dueAt: fields.dueDate ? instant(fields.dueDate, fields.dueTime ?? END_OF_DAY) : null,
        estimateMin: fields.estimateMin ?? options.defaultEstimateMin ?? 30,
        priority: fields.priority ?? 2,
      });
      return {
        records: [{ store: 'tasks', record: task }],
        primary: { type: 'task', id: task.id },
      };
    }
    case 'event': {
      const date = fields.date ?? today;
      const startMin = fields.startMin ?? 9 * 60;
      const endMin = fields.endMin ?? Math.min(1440, startMin + 60);
      const event = createRecord(EventSchema, clock, {
        title: fields.title,
        startAt: instant(date, startMin),
        endAt: instant(date, endMin),
        source: 'manual',
      });
      return {
        records: [{ store: 'events', record: event }],
        primary: { type: 'event', id: event.id },
      };
    }
    case 'note': {
      const note = createRecord(NoteSchema, clock, {
        title: fields.title,
        body: fields.body ?? '',
        projectId,
        areaId,
      });
      return {
        records: [{ store: 'notes', record: note }],
        primary: { type: 'note', id: note.id },
      };
    }
    case 'goal': {
      if (!areaId)
        throw new MaterializeError('needs-area', 'A goal needs an area. Pick one first.');
      const goal = createRecord(GoalSchema, clock, {
        title: fields.title,
        areaId,
        targetDate: fields.dueDate ?? null,
      });
      return {
        records: [{ store: 'goals', record: goal }],
        primary: { type: 'goal', id: goal.id },
      };
    }
    case 'routine': {
      const durationMin = Math.max(5, fields.durationMin ?? 30);
      const routine = createRecord(RoutineSchema, clock, {
        title: fields.title,
        recurrence: fields.recurrence ?? {
          freq: 'weekly',
          interval: 1,
          byDay: [],
          byMonthDay: null,
          count: null,
          until: null,
        },
        durationMin,
        preferredWindow:
          fields.startMin !== undefined
            ? { startMin: fields.startMin, endMin: Math.min(1440, fields.startMin + durationMin) }
            : null,
        areaId,
      });
      return {
        records: [{ store: 'routines', record: routine }],
        primary: { type: 'routine', id: routine.id },
      };
    }
    case 'bill': {
      const bill = createRecord(BillSchema, clock, {
        title: fields.title,
        amount: fields.amount ?? 0,
        currency: fields.currency ?? '',
        dueAt: fields.dueDate ?? addDays(today, 7),
        recurrence: fields.recurrence ?? null,
      });
      return {
        records: [{ store: 'bills', record: bill }],
        primary: { type: 'bill', id: bill.id },
      };
    }
    case 'commitment': {
      const name = fields.person ?? fields.people[0];
      if (!name) throw new MaterializeError('needs-person', 'Who is this about? Add @name.');
      const records: MaterializedRecord[] = [];
      let person = (options.people ?? []).find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (!person) {
        person = createRecord(PersonSchema, clock, { name });
        records.push({ store: 'people', record: person });
      }
      const commitment = createRecord(CommitmentSchema, clock, {
        personId: person.id,
        text: fields.title,
        dueAt: fields.dueDate ? instant(fields.dueDate, fields.dueTime ?? END_OF_DAY) : null,
        direction: fields.direction ?? 'owed-by-me',
      });
      records.push({ store: 'commitments', record: commitment });
      return { records, primary: { type: 'commitment', id: commitment.id } };
    }
  }
}
