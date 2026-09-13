import type { Clock } from '../clock';
import { toLocalDate } from '../dates';
import type {
  DayCommitment,
  LocalDate,
  Project,
  RolloverTarget,
  Rule,
  Session,
  Task,
} from '../schema';
import { needsActual } from './completion';
import { suggestRollover } from './rollover';
import { timeByArea, type AreaMinutes } from './timeByArea';

/**
 * The evening shutdown's data: the commitment against what got done, the
 * tasks that need an actual, where the day's time went, and a rollover
 * suggestion for every unfinished task. Pure; the flow writes the answers
 * in one transaction.
 */

export interface EveningSnapshot {
  tasks: readonly Task[];
  sessions: readonly Session[];
  dayCommitments: readonly DayCommitment[];
  projects?: readonly Project[];
  rules?: readonly Rule[];
}

export interface RolloverSuggestion {
  task: Task;
  suggestion: RolloverTarget;
}

export interface EveningReview {
  date: LocalDate;
  commitment: DayCommitment | null;
  /** Every task the commitment named, in commitment order. */
  committed: Task[];
  done: Task[];
  /** Committed and not done: exactly what rollover asks about. Archived tasks left the day. */
  unfinished: Task[];
  /** Done on `date` with no actual and no session. */
  needsActual: Task[];
  timeByArea: AreaMinutes[];
  rollover: RolloverSuggestion[];
}

export function buildEvening(
  snapshot: EveningSnapshot,
  date: LocalDate,
  clock: Clock,
): EveningReview {
  const now = clock.now();
  const commitment =
    snapshot.dayCommitments.find((c) => c.deletedAt === null && c.date === date) ?? null;
  const taskById = new Map(
    snapshot.tasks.filter((t) => t.deletedAt === null).map((t) => [t.id, t] as const),
  );
  const committed = (commitment?.acceptedTaskIds ?? [])
    .map((id) => taskById.get(id))
    .filter((t): t is Task => t !== undefined);
  const done = committed.filter((t) => t.status === 'done');
  const unfinished = committed.filter((t) => t.status !== 'done' && t.status !== 'archived');

  const completedToday = [...taskById.values()].filter(
    (t) => t.completedAt !== null && toLocalDate(new Date(t.completedAt)) === date,
  );

  return {
    date,
    commitment,
    committed,
    done,
    unfinished,
    needsActual: needsActual(completedToday, snapshot.sessions),
    timeByArea: timeByArea(
      { sessions: snapshot.sessions, tasks: snapshot.tasks, projects: snapshot.projects, now },
      { from: date, to: date },
    ),
    rollover: unfinished.map((task) => ({
      task,
      suggestion: suggestRollover(task, snapshot.rules),
    })),
  };
}
