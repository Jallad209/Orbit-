import type { CaptureType, LocalDate, MinuteOfDay, Priority, Recurrence } from '../schema';

export type { CaptureType };

export const CAPTURE_TYPES: readonly CaptureType[] = [
  'task',
  'event',
  'note',
  'goal',
  'routine',
  'bill',
  'commitment',
];

export interface CaptureContext {
  /** "now" for relative dates. Injected so tests are deterministic. */
  now: Date;
  /** Known names for matching bare mentions ("ask Omar"). */
  people?: readonly string[];
  /** Known project titles for `#project` and bare matches. */
  projects?: readonly string[];
}

/**
 * Everything the parser could pull out. Dates are local calendar dates and
 * times are minutes-of-day so results are timezone independent; the app
 * combines them with `toInstant` when it creates records.
 */
export interface CaptureFields {
  title: string;
  /** task, goal, bill, commitment */
  dueDate?: LocalDate;
  dueTime?: MinuteOfDay;
  /** event */
  date?: LocalDate;
  startMin?: MinuteOfDay;
  endMin?: MinuteOfDay;
  /** routine (also bill recurrence) */
  recurrence?: Recurrence;
  timesPerWeek?: number;
  durationMin?: number;
  /** bill */
  amount?: number;
  currency?: string;
  /** commitment */
  person?: string;
  direction?: 'owed-by-me' | 'owed-to-me';
  /** note */
  body?: string;
  /** task */
  estimateMin?: number;
  priority?: Priority;
  /** mentions found anywhere */
  people: string[];
  projects: string[];
}

export type TokenKind =
  | 'prefix'
  | 'date'
  | 'time'
  | 'recurrence'
  | 'money'
  | 'estimate'
  | 'priority'
  | 'person'
  | 'project'
  | 'cue';

/** A matched span in the source text, kept so the UI can render chips. */
export interface CaptureToken {
  kind: TokenKind;
  text: string;
  start: number;
  end: number;
  /** Human label for the chip, e.g. "Fri 18 Sep" or "every month". */
  label: string;
}

export interface CaptureAlternative {
  type: CaptureType;
  score: number;
}

export interface CaptureResult {
  text: string;
  type: CaptureType;
  /** 0..1. Explicit prefixes are 1. */
  confidence: number;
  /** True when the user forced the type with a prefix. */
  explicit: boolean;
  fields: CaptureFields;
  /** Every type, best first. The UI cycles through these with Tab. */
  alternatives: CaptureAlternative[];
  tokens: CaptureToken[];
}

/** Swappable classifier (a local model can implement this later). */
export interface Classifier {
  classify(text: string, ctx: CaptureContext): CaptureResult;
}
