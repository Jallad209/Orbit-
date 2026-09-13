import type { Clock } from '../clock';
import { createRecord } from '../records';
import type { DayCommitment } from '../schema';
import { BlockSchema, DayCommitmentSchema } from '../schema';
import type { MaterializedPlan, PlanProposal } from './types';

/**
 * Turn a proposal into the records acceptance stores: one `DayCommitment`
 * and a planner `Block` per proposed part. Fixed blocks and events are
 * already stored, so they are not repeated. When the day already has a
 * commitment its id is kept, so accepting twice updates rather than adds.
 */
export function materializePlan(
  proposal: PlanProposal,
  clock: Clock,
  existing: DayCommitment | null = null,
): MaterializedPlan {
  const blocks = proposal.blocks
    .filter((b) => b.kind === 'task' || b.kind === 'routine')
    .map((b) =>
      createRecord(BlockSchema, clock, {
        date: proposal.date,
        startMin: b.startMin,
        endMin: b.endMin,
        taskId: b.taskId,
        routineInstanceId: b.routineInstanceId,
        eventId: null,
        locked: false,
        source: 'planner',
      }),
    );
  const fields = {
    date: proposal.date,
    acceptedTaskIds: proposal.commitment.acceptedTaskIds,
    energy: proposal.energy,
    acceptedAt: clock.now().toISOString(),
  };
  const commitment = existing
    ? DayCommitmentSchema.parse({ ...existing, ...fields })
    : createRecord(DayCommitmentSchema, clock, fields);
  return { commitment, blocks };
}
