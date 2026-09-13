import { fromLocalDate } from '../dates';
import type { Goal, Id, LocalDate } from '../schema';
import { energyGap } from './candidates';
import type { Candidate, PlanSettings, ScoreComponents } from './types';

const DAY_MS = 86_400_000;

export interface Scored {
  candidate: Candidate;
  score: number;
  components: ScoreComponents;
  /** Days from the planned date to the due date; null without one. Negative = overdue. */
  daysToDue: number | null;
}

export function daysFromDate(from: LocalDate, to: LocalDate): number {
  return Math.round((fromLocalDate(to).getTime() - fromLocalDate(from).getTime()) / DAY_MS);
}

/** Due today or overdue → 3; then decays toward 1 as the due date recedes. */
export function pressure(daysToDue: number | null): number {
  if (daysToDue === null) return 1;
  if (daysToDue <= 0) return 3;
  return 1 + 2 / (1 + daysToDue);
}

export function overdueBoost(daysToDue: number | null): number {
  if (daysToDue === null || daysToDue >= 0) return 1;
  return 1 + Math.min(-daysToDue, 7) * 0.1;
}

/** Goal importance 1..5 → 0.8..1.6; no goal → 1. */
export function importanceWeight(importance: number | null): number {
  return importance === null ? 1 : 0.6 + importance * 0.2;
}

const PRIORITY_WEIGHT: Record<number, number> = { 1: 1.3, 2: 1, 3: 0.8 };

export function priorityWeight(priority: number): number {
  return PRIORITY_WEIGHT[priority] ?? 1;
}

/** Up to +50 % after 30 untouched days. */
export function stalenessWeight(untouchedDays: number): number {
  return 1 + Math.min(untouchedDays, 30) / 60;
}

/** Same energy 1; easier than the day 0.9 / 0.8; one step harder 0.6. */
export function energyFit(candidate: Candidate, day: PlanSettings['energy']): number {
  const gap = energyGap(candidate.energy, day);
  if (gap === 0) return 1;
  if (gap === -1) return 0.9;
  if (gap <= -2) return 0.8;
  return 0.6;
}

/**
 * Transparent multiplicative score. Every factor is kept so the UI can
 * render "why". Routines get a flat base: they are habits, not deadlines.
 */
export function scoreCandidate(
  c: Candidate,
  date: LocalDate,
  settings: PlanSettings,
  goals: ReadonlyMap<Id, Goal>,
): Scored {
  const daysToDue = c.dueDate ? daysFromDate(date, c.dueDate) : null;
  const goal = c.goalId ? goals.get(c.goalId) : undefined;
  const components: ScoreComponents = {
    pressure: c.kind === 'routine' ? 2.5 : pressure(daysToDue),
    importance: c.kind === 'routine' ? 1 : importanceWeight(goal ? goal.importance : null),
    priority: c.kind === 'routine' ? 1 : priorityWeight(c.priority),
    staleness: c.kind === 'routine' ? 1 : stalenessWeight(c.untouchedDays),
    energyFit: energyFit(c, settings.energy),
    overdueBoost: c.kind === 'routine' ? 1 : overdueBoost(daysToDue),
    nextAction: c.isNextAction ? 1.25 : 1,
  };
  const score =
    components.pressure *
    components.importance *
    components.priority *
    components.staleness *
    components.energyFit *
    components.overdueBoost *
    components.nextAction;
  return { candidate: c, score: round3(score), components, daysToDue };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Total order: score, then due date, priority, age, id. Same input → same order. */
export function compareScored(a: Scored, b: Scored): number {
  if (b.score !== a.score) return b.score - a.score;
  const ad = a.candidate.dueDate ?? '9999-12-31';
  const bd = b.candidate.dueDate ?? '9999-12-31';
  if (ad !== bd) return ad < bd ? -1 : 1;
  if (a.candidate.priority !== b.candidate.priority)
    return a.candidate.priority - b.candidate.priority;
  if (a.candidate.createdAt !== b.candidate.createdAt)
    return a.candidate.createdAt < b.candidate.createdAt ? -1 : 1;
  return a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0;
}
