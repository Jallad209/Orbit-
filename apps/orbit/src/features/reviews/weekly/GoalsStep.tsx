import { systemClock } from '@orbit/core';
import type { Clock, Goal } from '@orbit/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { GoalHealthBadge } from '@/components/HealthBadge';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { useRepoQuery } from '@/data/useQuery';
import { routeFor } from '@/lib/destinations';
import type { StepSession } from '../useReviewSession';
import { loadGoalsStep, setAreaTargetWithin, updateGoalWithin } from '../weeklyService';
import { DeferButton, StepFrame } from './StepFrame';

/**
 * Step 4: active goals with their attention signal, plus each area's
 * weekly-hours target in its own clearly labelled control. Goals get no
 * invented hour requirement; changing an area target refreshes the
 * capacity step later.
 */
export function GoalsStep({
  session,
  clock = systemClock,
}: {
  session: StepSession;
  clock?: Clock;
}) {
  const { data } = useRepoQuery((r) => loadGoalsStep(r, clock), [session.review.revision]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  if (!data) return <p className="text-sm text-ink-muted">Loading…</p>;
  const items = data.goals.map((g) => ({ type: 'goal' as const, id: g.goal.id }));
  const fp = data.fingerprint;
  const update = (
    goal: Goal,
    patch: Partial<Pick<Goal, 'importance' | 'targetDate' | 'status'>>,
    kind: 'update-goal' | 'goal-status',
  ) =>
    void session.submit(kind, [{ type: 'goal', id: goal.id }], fp, patch, (tx) =>
      updateGoalWithin(tx, goal, patch),
    );
  return (
    <StepFrame
      session={session}
      items={items}
      fingerprint={fp}
      intro="Active goals and the area targets behind them. Adjust importance or the target date, mark a goal achieved or dropped, or acknowledge it; edit an area's weekly hours in its own control below."
      gate="Review, act on, or defer them."
    >
      {data.goals.length === 0 ? (
        <p className="text-[13px] text-ink-faint">No active goals.</p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {data.goals.map(({ goal, attention, area, projects }) => {
          const ref = { type: 'goal' as const, id: goal.id };
          const decided = session.decided.has(`goal:${goal.id}`);
          return (
            <li
              key={goal.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2 text-sm"
              data-testid="review-goal"
              data-decided={decided}
            >
              <Link
                to={routeFor({ type: 'goal', id: goal.id })!}
                className="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {goal.title}
              </Link>
              {area ? <span className="text-[12px] text-ink-muted">{area.name}</span> : null}
              <GoalHealthBadge goal={goal} attention={attention} />
              <span className="text-[12px] text-ink-faint">
                {projects.length} project{projects.length === 1 ? '' : 's'}
              </span>
              {decided ? (
                <Badge tone="ok">decided</Badge>
              ) : (
                <>
                  <Select
                    aria-label={`Importance for ${goal.title}`}
                    value={goal.importance}
                    onChange={(e) =>
                      update(goal, { importance: Number(e.target.value) }, 'update-goal')
                    }
                    className="h-8 w-24"
                    disabled={session.busy || session.stale}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {'★'.repeat(n)}
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="date"
                    aria-label={`Target date for ${goal.title}`}
                    value={goal.targetDate ?? ''}
                    onChange={(e) =>
                      update(goal, { targetDate: e.target.value || null }, 'update-goal')
                    }
                    className="h-8 w-40"
                    disabled={session.busy || session.stale}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={session.busy || session.stale}
                    onClick={() => update(goal, { status: 'achieved' }, 'goal-status')}
                  >
                    Achieved
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={session.busy || session.stale}
                    onClick={() => update(goal, { status: 'dropped' }, 'goal-status')}
                  >
                    Drop
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={session.busy || session.stale}
                    onClick={() =>
                      void session.submit('acknowledge', [ref], fp, {}, async () => ({}))
                    }
                  >
                    Reviewed
                  </Button>
                  <DeferButton session={session} target={ref} fingerprint={fp} />
                </>
              )}
            </li>
          );
        })}
      </ul>
      <section
        aria-label="Area weekly targets"
        className="rounded-md border border-dashed border-line p-3"
      >
        <h3 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
          Area weekly-hours targets
        </h3>
        <p className="mt-1 text-[12px] text-ink-faint">
          Hours per week you commit to each area. This feeds the capacity check; goals have no hour
          requirement of their own.
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {data.areas.map((area) => {
            const value = targets[area.id] ?? String(area.weeklyHoursTarget);
            const changed = Number(value) !== area.weeklyHoursTarget;
            return (
              <li key={area.id} className="flex items-center gap-2 text-sm">
                <span className="w-40 truncate">{area.name}</span>
                <Input
                  type="number"
                  min={0}
                  max={168}
                  step="0.5"
                  aria-label={`Weekly hours target for ${area.name}`}
                  value={value}
                  onChange={(e) => setTargets((t) => ({ ...t, [area.id]: e.target.value }))}
                  className="h-8 w-24"
                />
                <span className="text-[12px] text-ink-faint">h / week</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!changed || session.busy || session.stale}
                  onClick={() =>
                    void session.submit(
                      'area-target',
                      [{ type: 'area', id: area.id }],
                      fp,
                      { weeklyHoursTarget: Number(value) },
                      (tx) => setAreaTargetWithin(tx, area.id, Number(value)),
                    )
                  }
                >
                  Save target
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
    </StepFrame>
  );
}
