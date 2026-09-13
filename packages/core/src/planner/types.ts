import type {
  Area,
  Block,
  DayCommitment,
  Energy,
  Event,
  Goal,
  Id,
  LocalDate,
  MinuteOfDay,
  Project,
  Routine,
  RoutineInstance,
  Rule,
  Session,
  Task,
  TimeWindow,
} from '../schema';

/** Everything `planDay` reads. Arrays, never a repository: the engine stays pure. */
export interface PlanSnapshot {
  areas: readonly Area[];
  goals: readonly Goal[];
  projects: readonly Project[];
  tasks: readonly Task[];
  events?: readonly Event[];
  routines?: readonly Routine[];
  routineInstances?: readonly RoutineInstance[];
  blocks?: readonly Block[];
  sessions?: readonly Session[];
  rules?: readonly Rule[];
}

export interface PlanSettings {
  /** Minutes the day can hold work. Default 09:00–18:00. */
  workingWindow: TimeWindow;
  /** Never planned into: lunch, school run, … */
  restBoundaries: readonly TimeWindow[];
  /** The energy the user has today; tasks two steps above it are excluded. */
  energy: Energy;
  /** Gap left after every placed block. */
  bufferMin: number;
  /** Block starts and lengths snap to this grid. */
  gridMin: number;
  /** Shortest block worth placing. */
  minBlockMin: number;
  /** Only tasks longer than this may be split across free intervals. */
  splitThresholdMin: number;
  /** No split part is shorter than this. */
  minSplitPartMin: number;
  maxSplitParts: number;
  /** Candidates scoring below this are left out with reason `lowScore`. */
  minScore: number;
  /** Tasks the user removed from the proposal; left out with reason `user`. */
  excludeTaskIds: readonly Id[];
}

export const DEFAULT_PLAN_SETTINGS: PlanSettings = {
  workingWindow: { startMin: 540, endMin: 1080 },
  restBoundaries: [],
  energy: 'medium',
  bufferMin: 10,
  gridMin: 15,
  minBlockMin: 15,
  splitThresholdMin: 90,
  minSplitPartMin: 30,
  maxSplitParts: 2,
  minScore: 0,
  excludeTaskIds: [],
};

/** A stretch of time the planner may fill, with the constraints that apply inside it. */
export interface FreeInterval {
  startMin: MinuteOfDay;
  endMin: MinuteOfDay;
  /** Set by a `reserve` rule: only this area's work may go here. */
  areaId: Id | null;
  /** Cleared by a `noHighEnergyAfter` rule. */
  highEnergyAllowed: boolean;
}

export type BusyKind = 'event' | 'block' | 'rest' | 'past' | 'reserve';

export interface BusyInterval {
  startMin: MinuteOfDay;
  endMin: MinuteOfDay;
  kind: BusyKind;
  refId: Id | null;
  label: string;
}

export interface DayCapacity {
  date: LocalDate;
  workingWindow: TimeWindow;
  free: FreeInterval[];
  busy: BusyInterval[];
  /** Sum of free interval lengths. */
  freeMin: number;
}

export type CandidateKind = 'task' | 'routine';

export interface Candidate {
  kind: CandidateKind;
  /** Task id, or routine-instance id. */
  id: Id;
  title: string;
  durationMin: number;
  energy: Energy;
  areaId: Id | null;
  projectId: Id | null;
  goalId: Id | null;
  priority: number;
  /** Effective due date: the task's own, else its project's deadline. */
  dueDate: LocalDate | null;
  dueSource: 'task' | 'project' | null;
  /** Minute of day the task is due when it is due on the planned date with a time. */
  dueMin: MinuteOfDay | null;
  /** Routines: where the user prefers them. */
  preferredWindow: TimeWindow | null;
  isNextAction: boolean;
  /** Days since the task, or a session on it, last changed. */
  untouchedDays: number;
  createdAt: string;
}

export interface ScoreComponents {
  /** Deadline pressure curve; 1 without a due date. */
  pressure: number;
  /** From the goal's importance; 1 without a goal. */
  importance: number;
  priority: number;
  /** 1 + a bonus that grows the longer a task sits untouched. */
  staleness: number;
  /** Match between the task's energy and the day's. */
  energyFit: number;
  /** Extra weight once a task is past due. */
  overdueBoost: number;
  /** 1.25 when the task is its project's next action. */
  nextAction: number;
}

/** Why a task is in the plan: the score, its parts, and plain-language reasons. */
export interface Why {
  score: number;
  components: ScoreComponents;
  reasons: string[];
  placedAt: Array<{ startMin: MinuteOfDay; endMin: MinuteOfDay }>;
}

export type LeftOutReason = 'blocked' | 'energy' | 'capacity' | 'lowScore' | 'scheduled' | 'user';

export interface LeftOut {
  kind: CandidateKind;
  id: Id;
  title: string;
  reason: LeftOutReason;
  detail: string;
  score: number | null;
}

export type ProposedBlockKind = 'task' | 'routine' | 'event' | 'fixed';

export interface ProposedBlock {
  /** Stable within a proposal: `${refId}#${part}`. */
  key: string;
  kind: ProposedBlockKind;
  startMin: MinuteOfDay;
  endMin: MinuteOfDay;
  title: string;
  taskId: Id | null;
  routineInstanceId: Id | null;
  eventId: Id | null;
  /** Fixed blocks and events cannot move; proposed blocks can. */
  locked: boolean;
  /** For split tasks: which part this is. */
  part: { index: number; of: number } | null;
  /** For `fixed`: the stored block this mirrors. */
  existingBlockId: Id | null;
}

export interface PlanProposal {
  date: LocalDate;
  energy: Energy;
  capacity: DayCapacity;
  /** Every block on the day, fixed and proposed, in time order. */
  blocks: ProposedBlock[];
  commitment: { date: LocalDate; acceptedTaskIds: Id[]; energy: Energy };
  explanations: Record<Id, Why>;
  leftOut: LeftOut[];
  stats: { candidates: number; placed: number; plannedMin: number; freeMin: number };
}

/** What acceptance writes. */
export interface MaterializedPlan {
  commitment: DayCommitment;
  blocks: Block[];
}
