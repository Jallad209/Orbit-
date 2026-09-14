import type { Clock, DayLoad, Insight, LocalDate } from '@orbit/core';
import { OVERLOAD_HORIZON_DAYS, addDays, systemClock } from '@orbit/core';
import { ShieldAlert } from 'lucide-react';
import { useCallback } from 'react';
import { Link } from 'react-router';
import type { Repository } from '@orbit/storage';
import { useRepoQuery } from '@/data/useQuery';
import { loadDayLoad } from '@/features/insights/insightService';
import { useInsights } from '@/features/insights/useInsights';

interface Props {
  date: LocalDate;
  clock?: Clock;
}

/**
 * The Timeline header's overload warning. Inside the seven-date horizon it
 * reads the shared report (the same day-load result the Insights page
 * shows, suppressed or not); for any other date it calls the shared
 * day-load helper directly, so the header can never disagree with the
 * evidence page.
 */
export function OverloadWarning({ date, clock = systemClock }: Props) {
  const { view } = useInsights();
  const today = view?.report.today ?? null;
  const inHorizon = today !== null && date >= today && date < addDays(today, OVERLOAD_HORIZON_DAYS);
  const fromReport: Insight | null = inHorizon
    ? (view?.report.insights.find((i) => i.key === `overloaded-day:${date}`) ?? null)
    : null;
  const query = useCallback(
    (repo: Repository) =>
      inHorizon || today === null ? Promise.resolve(null) : loadDayLoad(repo, date, clock),
    [inHorizon, today, date, clock],
  );
  const { data: direct } = useRepoQuery<DayLoad | null>(query, [query]);

  const load =
    fromReport !== null
      ? {
          demandMin: fromReport.metrics.demandMin ?? 0,
          availableMin: fromReport.metrics.availableMin ?? 0,
          overloaded: true,
        }
      : direct
        ? {
            demandMin: direct.demandMin,
            availableMin: direct.capacity.availableMin,
            overloaded: direct.overloaded,
          }
        : null;
  if (!load || !load.overloaded) return null;
  return (
    <p
      role="status"
      data-testid="overload-warning"
      className="flex flex-wrap items-center gap-2 rounded-md border border-danger/30 bg-danger-soft/40 px-3 py-2 text-[13px] text-ink"
    >
      <ShieldAlert className="size-4 text-danger" aria-hidden="true" />
      <span>
        Overloaded: <span className="tnum">{load.demandMin} min</span> of committed work against{' '}
        <span className="tnum">{load.availableMin} min</span> of available work time.
      </span>
      {inHorizon ? (
        <Link to={`/insights?open=overloaded-day:${date}`} className="underline">
          See the evidence
        </Link>
      ) : (
        <span className="text-ink-faint">Outside the insights horizon; same calculation.</span>
      )}
    </p>
  );
}
