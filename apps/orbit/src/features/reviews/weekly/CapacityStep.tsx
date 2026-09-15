import {
  AGGREGATE_NOTE,
  WEEKEND_NOTE,
  WORKLOAD_NOTE,
  systemClock,
  toLocalDate,
  weekdayName,
} from '@orbit/core';
import type { Clock } from '@orbit/core';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { useRepoQuery } from '@/data/useQuery';
import type { StepSession } from '../useReviewSession';
import { loadCapacityStep } from '../weeklyService';
import { StepFrame } from './StepFrame';

function hours(min: number): string {
  return `${(min / 60).toFixed(1)} h`;
}

/**
 * Step 6: the frozen target week, two comparisons kept apart — booked work
 * against available time, area targets against available time — with the
 * saved per-day threshold flagging individual days even when the weekly
 * total fits. Read-only: edits happen on their real screens; "Plan this
 * day" opens a proposal and accepts nothing.
 */
export function CapacityStep({
  session,
  clock = systemClock,
}: {
  session: StepSession;
  clock?: Clock;
}) {
  const { data } = useRepoQuery(
    (r) => loadCapacityStep(r, session.review, clock),
    [session.review.revision, session.review.id],
  );
  if (!data) return <p className="text-sm text-ink-muted">Loading…</p>;
  const { week } = data;
  const today = toLocalDate(clock.now());
  return (
    <StepFrame
      session={session}
      items={[]}
      fingerprint={data.fingerprint}
      intro={`The week of ${week.weekStart} to ${week.weekEnd}, as recorded when this review started. Two separate comparisons; neither is added to the other, because booked work may already be fulfilling the targets.`}
      gate=""
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="flex flex-col gap-1" data-testid="capacity-booked">
          <h3 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
            Booked work vs available time
          </h3>
          <p className="text-h2 font-semibold tnum">
            {hours(week.bookedMin)}{' '}
            <span className="text-sm font-normal text-ink-muted">
              of {hours(week.availableMin)}
            </span>
          </p>
          {week.bookedOverloaded ? (
            <Badge tone="danger">More booked than available</Badge>
          ) : (
            <Badge tone="ok">Fits in total</Badge>
          )}
          <p className="text-[12px] text-ink-faint">
            Threshold per day: committed work over {Math.round(data.dayOverloadRatio * 100)}% of
            that day's capacity.
          </p>
        </Card>
        <Card className="flex flex-col gap-1" data-testid="capacity-targets">
          <h3 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
            Area targets vs available time
          </h3>
          <p className="text-h2 font-semibold tnum">
            {hours(week.targetMin)}{' '}
            <span className="text-sm font-normal text-ink-muted">
              of {hours(week.availableMin)}
            </span>
          </p>
          {week.targetDeficitMin > 0 ? (
            <Badge tone="danger">{hours(week.targetDeficitMin)} short</Badge>
          ) : (
            <Badge tone="ok">Targets fit</Badge>
          )}
          <ul className="text-[12px] text-ink-faint">
            {week.targets.map((t) => (
              <li key={t.ref.id}>
                {t.name}: {t.weeklyHoursTarget} h
              </li>
            ))}
            {week.targets.length === 0 ? <li>No area targets set.</li> : null}
          </ul>
        </Card>
      </div>
      <ul className="flex flex-col gap-1" aria-label="Days">
        {week.days.map((day) => (
          <li
            key={day.date}
            className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm"
            data-testid="capacity-day"
            data-overloaded={day.overloaded}
          >
            <span className="w-32 font-medium">
              {weekdayName(day.date)} {day.date.slice(5)}
            </span>
            <span className="tnum">
              {day.demandMin} min booked / {day.capacity.availableMin} min available
            </span>
            {day.overloaded ? (
              <Badge tone="danger">over {Math.round(data.dayOverloadRatio * 100)}%</Badge>
            ) : null}
            <span className="text-[12px] text-ink-faint">
              {day.blocks.length} block{day.blocks.length === 1 ? '' : 's'},{' '}
              {day.unscheduled.length} unscheduled
            </span>
            <span className="ml-auto flex gap-2 text-[12px]">
              <Link to={`/timeline?date=${day.date}`} className="underline">
                Timeline
              </Link>
              {day.date === today ? (
                <Link to="/today?regenerate=1" className="underline">
                  Plan this day
                </Link>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-ink-faint">{WORKLOAD_NOTE}</p>
      <p className="text-[12px] text-ink-faint">
        {WEEKEND_NOTE} {AGGREGATE_NOTE}
      </p>
      <p className="text-[12px] text-ink-faint">
        Computed {data.week.computedAt.slice(0, 16).replace('T', ' ')}; acknowledging records these
        numbers as reviewed.
      </p>
    </StepFrame>
  );
}
