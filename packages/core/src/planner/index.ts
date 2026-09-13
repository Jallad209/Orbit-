import type { Clock } from '../clock';
import { systemClock } from '../clock';
import type { Goal, Id, LocalDate, Project } from '../schema';
import { buildCapacity, isFixedBlock, localRange } from './capacity';
import { selectCandidates } from './candidates';
import { explain } from './explain';
import { greedyFill, toBlocks } from './fill';
import { compareScored, scoreCandidate } from './score';
import type { PlanProposal, PlanSettings, PlanSnapshot, ProposedBlock, Why } from './types';
import { DEFAULT_PLAN_SETTINGS } from './types';

export * from './types';
export { buildCapacity, isFixedBlock, localRange, roundUpTo } from './capacity';
export { selectCandidates, energyGap } from './candidates';
export {
  scoreCandidate,
  compareScored,
  pressure,
  overdueBoost,
  importanceWeight,
  priorityWeight,
  stalenessWeight,
  energyFit,
  daysFromDate,
} from './score';
export type { Scored } from './score';
export { greedyFill } from './fill';
export { reasonsFor } from './explain';
export { materializePlan } from './accept';

/**
 * The heart of Orbit. Pure: a snapshot, a date, and settings in; a proposal
 * out. Constraints first (capacity, readiness, energy), then a transparent
 * score, then greedy fill, then an explanation for every decision. The same
 * input always yields the same proposal.
 */
export function planDay(
  snapshot: PlanSnapshot,
  date: LocalDate,
  settings: Partial<PlanSettings> = {},
  clock: Clock = systemClock,
): PlanProposal {
  const s: PlanSettings = { ...DEFAULT_PLAN_SETTINGS, ...settings };
  const now = clock.now();
  const capacity = buildCapacity(snapshot, date, s, now);
  const { candidates, leftOut } = selectCandidates(snapshot, date, s, now);

  const goals = new Map<Id, Goal>(
    snapshot.goals.filter((g) => g.deletedAt === null).map((g) => [g.id, g]),
  );
  const projects = new Map<Id, Project>(
    snapshot.projects.filter((p) => p.deletedAt === null).map((p) => [p.id, p]),
  );
  const ranked = candidates.map((c) => scoreCandidate(c, date, s, goals)).sort(compareScored);
  const fill = greedyFill(ranked, capacity.free, s);

  const explanations: Record<Id, Why> = {};
  const blocks: ProposedBlock[] = [];
  const acceptedTaskIds: Id[] = [];
  const ctx = { goals, projects, settings: s };
  for (const p of fill.placed) {
    explanations[p.scored.candidate.id] = explain(p, ctx);
    blocks.push(...toBlocks(p));
    if (p.scored.candidate.kind === 'task') acceptedTaskIds.push(p.scored.candidate.id);
  }

  const taskTitle = new Map(snapshot.tasks.map((t) => [t.id, t.title]));
  for (const b of snapshot.blocks ?? []) {
    if (b.date !== date || !isFixedBlock(b)) continue;
    blocks.push({
      key: `${b.id}#fixed`,
      kind: 'fixed',
      startMin: b.startMin,
      endMin: b.endMin,
      title: b.taskId ? (taskTitle.get(b.taskId) ?? 'Task') : 'Block',
      taskId: b.taskId,
      routineInstanceId: b.routineInstanceId,
      eventId: b.eventId,
      locked: true,
      part: null,
      existingBlockId: b.id,
    });
  }
  for (const e of snapshot.events ?? []) {
    if (e.deletedAt !== null) continue;
    const r = localRange(e.startAt, e.endAt, date);
    if (!r) continue;
    blocks.push({
      key: `${e.id}#event`,
      kind: 'event',
      ...r,
      title: e.title,
      taskId: null,
      routineInstanceId: null,
      eventId: e.id,
      locked: true,
      part: null,
      existingBlockId: null,
    });
  }
  blocks.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || (a.key < b.key ? -1 : 1));

  const all = [...leftOut, ...fill.leftOut].sort(
    (a, b) =>
      (b.score ?? -1) - (a.score ?? -1) || a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1),
  );
  const plannedMin = fill.placed.reduce(
    (sum, p) => sum + p.parts.reduce((m, part) => m + (part.endMin - part.startMin), 0),
    0,
  );

  return {
    date,
    energy: s.energy,
    capacity,
    blocks,
    commitment: { date, acceptedTaskIds, energy: s.energy },
    explanations,
    leftOut: all,
    stats: {
      candidates: candidates.length,
      placed: fill.placed.length,
      plannedMin,
      freeMin: capacity.freeMin,
    },
  };
}
