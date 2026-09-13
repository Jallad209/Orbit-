import type { Clock } from '../clock';
import { addDays } from '../dates';
import { planDay } from '../planner';
import type { PlanProposal, PlanSettings, PlanSnapshot } from '../planner/types';
import type { Bill, Energy, Id, LocalDate, Milestone } from '../schema';
import { computeAtRisk, type AtRisk, type AtRiskOptions } from './atRisk';

/**
 * The morning briefing's data: an energy default, what is at risk, bills
 * coming due, and the day's proposal. Pure like `planDay`; the flow's
 * steps read one object and acceptance goes through the planner's own
 * `materializePlan`.
 */

export interface MorningSnapshot extends PlanSnapshot {
  milestones?: readonly Milestone[];
  bills?: readonly Bill[];
}

export interface MorningOptions extends AtRiskOptions {
  /** Days ahead a bill counts as due. Default 3. */
  billDays?: number;
}

export interface MorningBriefing {
  date: LocalDate;
  /** The energy the proposal was built for; the flow's step-one default. */
  energy: Energy;
  proposal: PlanProposal;
  atRisk: AtRisk;
  /** Unpaid bills due on or before `date + billDays`, overdue ones first. */
  billsDue: Bill[];
}

/** Unpaid bills due within `days` of `date`, including any already overdue. */
export function billsDueWithin(bills: readonly Bill[], date: LocalDate, days: number): Bill[] {
  const limit = addDays(date, days);
  return bills
    .filter((b) => b.deletedAt === null && !b.paid && b.dueAt <= limit)
    .sort((a, b) => (a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0));
}

export function buildMorning(
  snapshot: MorningSnapshot,
  date: LocalDate,
  settings: Partial<PlanSettings>,
  clock: Clock,
  options: MorningOptions = {},
): MorningBriefing {
  const now = clock.now();
  const proposal = planDay(snapshot, date, settings, clock);
  const planned = new Set<Id>();
  for (const b of proposal.blocks) if (b.taskId) planned.add(b.taskId);
  for (const b of snapshot.blocks ?? []) {
    if (b.deletedAt === null && b.date === date && b.taskId) planned.add(b.taskId);
  }
  const atRisk = computeAtRisk(
    {
      tasks: snapshot.tasks,
      projects: snapshot.projects,
      milestones: snapshot.milestones,
      sessions: snapshot.sessions,
      plannedTaskIds: planned,
      now,
    },
    date,
    options,
  );
  return {
    date,
    energy: proposal.energy,
    proposal,
    atRisk,
    billsDue: billsDueWithin(snapshot.bills ?? [], date, options.billDays ?? 3),
  };
}
