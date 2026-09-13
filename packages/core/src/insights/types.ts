import type { Clock } from '../clock';
import type {
  Area,
  Block,
  Commitment,
  DayCommitment,
  Event,
  Goal,
  Id,
  InsightKind,
  InsightSettings,
  InsightSeverity,
  InsightSubject,
  Instant,
  LocalDate,
  Milestone,
  Person,
  Project,
  Routine,
  RoutineInstance,
  Rule,
  Session,
  Task,
  TimeWindow,
} from '../schema';

export type { InsightKind, InsightSeverity, InsightSubject } from '../schema';

/**
 * The insights contract (week 11). `computeInsights` is pure: it reads a
 * snapshot of records and settings, takes an injected clock, and returns
 * observations whose every number is backed by evidence rows the UI can
 * open. Nothing here touches a repository, React, or the browser.
 */

/** Bump when a detector's meaning changes, so an until-change snooze taken under the old meaning lifts. */
export const INSIGHT_ALGORITHM_VERSION = 1;

/** Everything the engine reads. Arrays, never a repository. Tombstones are allowed where noted. */
export interface InsightSnapshot {
  areas: readonly Area[];
  goals: readonly Goal[];
  projects: readonly Project[];
  /** May include tombstones: they count as project activity, nothing else. */
  milestones: readonly Milestone[];
  /** May include tombstones, as above. */
  tasks: readonly Task[];
  sessions: readonly Session[];
  events: readonly Event[];
  routines: readonly Routine[];
  routineInstances: readonly RoutineInstance[];
  blocks: readonly Block[];
  dayCommitments: readonly DayCommitment[];
  people: readonly Person[];
  commitments: readonly Commitment[];
  rules: readonly Rule[];
}

/** The planning preferences the capacity calculation needs. */
export interface InsightPlanning {
  workingWindow: TimeWindow;
  restBoundaries: readonly TimeWindow[];
  /** Estimate for an accepted task whose own estimate is zero. */
  defaultEstimateMin: number;
  /** Planner rounding: block lengths snap up to this grid. Default 15. */
  gridMin?: number;
  /** Planner rounding: no block is shorter than this. Default 15. */
  minBlockMin?: number;
}

export interface InsightInput {
  snapshot: InsightSnapshot;
  settings: InsightSettings;
  planning: InsightPlanning;
  clock: Clock;
  /** The local date to treat as today. Derived from the clock when omitted. */
  today?: LocalDate;
}

// ---------------------------------------------------------------------------
// Evidence: the proof behind an observation, never another warning sentence.
// ---------------------------------------------------------------------------

export interface EvidenceRef {
  type:
    | 'task'
    | 'project'
    | 'milestone'
    | 'session'
    | 'person'
    | 'commitment'
    | 'area'
    | 'routine'
    | 'routineInstance'
    | 'event'
    | 'rule';
  id: Id;
}

/** A completed task's estimate against what was recorded. */
export interface TaskActualEvidence {
  kind: 'task-actual';
  ref: EvidenceRef;
  title: string;
  estimateMin: number;
  actualMin: number;
  /** Where the actual came from: the task's own field, or its closed sessions. */
  actualSource: 'actualMin' | 'sessions';
  completedAt: Instant;
}

/** The record responsible for a project's last activity. */
export interface ActivityEvidence {
  kind: 'activity';
  ref: EvidenceRef;
  title: string | null;
  at: Instant;
  /** The deletion of this record was the activity. */
  deleted: boolean;
  elapsedDays: number;
}

/** One stored block counted as committed work on a date. */
export interface BlockEvidence {
  kind: 'block';
  /** The task or routine instance; null for a manual block. */
  ref: EvidenceRef | null;
  blockId: Id;
  date: LocalDate;
  startMin: number;
  endMin: number;
  minutes: number;
  title: string;
  /** Task, routine, or manual work. */
  source: 'task' | 'routine' | 'manual';
  /** Some or all of the block lies outside the working window. */
  outsideWindow: boolean;
  /** The task is done (or the routine instance is done): still booked work for the day. */
  finished: boolean;
}

/** An accepted task with no block left on the date: its estimate counts once. */
export interface UnscheduledTaskEvidence {
  kind: 'unscheduled-task';
  ref: EvidenceRef & { type: 'task' };
  title: string;
  date: LocalDate;
  /** The task's own estimate; zero when it had none. */
  estimateMin: number;
  /** What was counted after the planner's default and rounding rules. */
  minutes: number;
  commitmentId: Id;
}

export type CapacityExclusionKind = 'rest' | 'event' | 'reserve';

export interface CapacityExclusion {
  kind: CapacityExclusionKind;
  label: string;
  /** Clipped to the working window. */
  startMin: number;
  endMin: number;
  /** The event or rule id; null for a rest boundary from settings. */
  refId: Id | null;
}

export interface AreaReservation {
  ruleId: Id;
  areaId: Id;
  label: string;
  startMin: number;
  endMin: number;
}

/** A date's full-day work capacity and how it was arrived at. */
export interface CapacityEvidence {
  kind: 'capacity';
  date: LocalDate;
  workingWindow: TimeWindow;
  windowMin: number;
  /** Rest, events, and whole reservations, each clipped; overlaps counted once in `excludedMin`. */
  exclusions: CapacityExclusion[];
  excludedMin: number;
  /** Reserved for one area: still work time, kept for the record. */
  areaReservations: AreaReservation[];
  availableMin: number;
}

/** One area's weekly target counted toward the week's requirement. */
export interface AreaTargetEvidence {
  kind: 'area-target';
  ref: EvidenceRef & { type: 'area' };
  name: string;
  weeklyHoursTarget: number;
  minutes: number;
}

/** One open commitment with a person. */
export interface CommitmentEvidence {
  kind: 'commitment';
  ref: EvidenceRef & { type: 'commitment' };
  text: string;
  direction: Commitment['direction'];
  dueAt: Instant | null;
  personId: Id;
}

export type InsightEvidence =
  | TaskActualEvidence
  | ActivityEvidence
  | BlockEvidence
  | UnscheduledTaskEvidence
  | CapacityEvidence
  | AreaTargetEvidence
  | CommitmentEvidence;

// ---------------------------------------------------------------------------
// Insight
// ---------------------------------------------------------------------------

export type ThresholdOperator = '>' | '>=' | '<' | '<=';
export type ThresholdUnit = 'ratio' | 'days' | 'minutes' | 'count';

export interface InsightThreshold {
  /** What was measured, as a short identifier (`actual/estimate`, `staleDays`). */
  metric: string;
  actual: number;
  operator: ThresholdOperator;
  limit: number;
  unit: ThresholdUnit;
  /** For detectors with a minimum sample: how many samples backed `actual`. */
  sampleSize: number | null;
  minSamples: number | null;
}

export interface InsightRange {
  from: LocalDate;
  to: LocalDate;
}

export interface Insight {
  /** Stable across runs: kind plus subject, never a title or a number. */
  key: string;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  detail: string;
  subject: InsightSubject;
  /** Never empty. */
  evidence: InsightEvidence[];
  threshold: InsightThreshold;
  /** The numbers behind the copy, unformatted (a ratio stays 1.4). */
  metrics: Record<string, number>;
  /** The dates the observation covers, when it has any. */
  range: InsightRange | null;
  /** Caveats the UI shows under the evidence. */
  notes: string[];
  computedAt: Instant;
  /** Changes when the relevant source data or settings change; not when time passes. */
  fingerprint: string;
  algorithmVersion: number;
}

// ---------------------------------------------------------------------------
// Coverage: an empty list must not read as "all clear".
// ---------------------------------------------------------------------------

export type UnavailableReason = 'no-subjects' | 'insufficient-samples' | 'no-targets';

export interface DetectorCoverage {
  kind: InsightKind;
  /** Subjects considered: areas, active projects, dates, weeks, or people. */
  subjects: number;
  /** Subjects with enough data to be judged. */
  eligible: number;
  /** How many insights the detector emitted. */
  emitted: number;
  /** Samples a subject needs before it is judged, when the detector has such a rule. */
  requiredSamples: number | null;
  /** The most samples any subject had, for "3 of 5" messages. */
  largestSample: number | null;
  /** The detector could reach a verdict for at least one subject. */
  available: boolean;
  unavailableReason: UnavailableReason | null;
}

/** When the next time-only change to the report happens, for one scheduled refresh. */
export interface InsightBoundaries {
  /** A project crosses its stale threshold. */
  nextStaleAt: Instant | null;
  /** The oldest counted estimate sample leaves its window. */
  nextSampleExpiryAt: Instant | null;
  /** Local midnight: dates and weeks roll over. */
  nextMidnightAt: Instant;
}

export interface InsightReport {
  insights: Insight[];
  coverage: DetectorCoverage[];
  computedAt: Instant;
  today: LocalDate;
  algorithmVersion: number;
  boundaries: InsightBoundaries;
}
