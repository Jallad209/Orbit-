import { formatDuration } from '@orbit/core';
import { useCallback } from 'react';
import type { Repository } from '@orbit/storage';
import { Card, ProgressBar, Skeleton } from '@/components/ui/Card';
import { useRepoQuery } from '@/data/useQuery';
import { loadPatternsStep } from '../weeklyService';
import type { StepSession } from '../useReviewSession';
import { StepFrame } from './StepFrame';

function rating(value: number | null): string {
  return value === null ? 'Not recorded' : `${value.toFixed(1)} / 5`;
}

export function PatternsStep({ session }: { session: StepSession }) {
  const query = useCallback(
    (repo: Repository) => loadPatternsStep(repo, session.review),
    [session.review],
  );
  const { data } = useRepoQuery(query, [query]);
  if (!data) return <Skeleton className="h-64" />;
  const report = data.report;
  const maxArea = Math.max(1, ...report.byArea.map((item) => item.minutes));
  return (
    <StepFrame
      session={session}
      items={[]}
      fingerprint={data.fingerprint}
      intro="A local summary of the week. Timer sessions come first; manual actuals fill only tasks without sessions. Journal text is never read."
      gate="Review the observations, then continue."
    >
      <div className="grid gap-4 md:grid-cols-2" data-testid="weekly-patterns">
        <Card>
          <h3 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
            Recorded time
          </h3>
          <p className="mt-2 text-h2 font-semibold tnum">{formatDuration(report.actualMinutes)}</p>
          <p className="text-[12px] text-ink-faint">
            {formatDuration(report.timerMinutes)} from timers ·{' '}
            {formatDuration(report.manualMinutes)} manual
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            Planned {formatDuration(report.plannedMinutes)}. {report.coverage.text}
          </p>
          {report.runningSessions ? (
            <p className="mt-1 text-[12px] text-gold-ink">
              {report.runningSessions} running session{report.runningSessions === 1 ? '' : 's'}{' '}
              excluded until stopped.
            </p>
          ) : null}
        </Card>
        <Card>
          <h3 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
            Spending
          </h3>
          <p className="mt-2 text-h2 font-semibold tnum">
            {report.spending.total.toFixed(2)} {report.spending.currency}
          </p>
          {report.spending.items.length ? (
            <ul className="mt-2 flex flex-col gap-1 text-sm" aria-label="Weekly spending by item">
              {report.spending.items.map((item) => (
                <li key={item.name} className="flex justify-between gap-3">
                  <span>
                    {item.name}
                    <span className="ml-1 text-[12px] text-ink-faint">
                      {item.count} item{item.count === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="tnum text-ink-faint">{item.total.toFixed(2)} JOD</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">No spending logged this week.</p>
          )}
        </Card>
        <Card>
          <h3 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
            Completion and rollover
          </h3>
          <p className="mt-2 text-sm text-ink">
            {report.completion.completedSameDay} of {report.completion.committed} committed task
            entries were completed on their planned day.
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {report.completion.rollovers} were still open after that day. This is an observation,
            not a score.
          </p>
        </Card>
        <Card>
          <h3 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
            Time by area
          </h3>
          {report.byArea.length ? (
            <ul className="mt-2 flex flex-col gap-2" aria-label="Recorded time by area">
              {report.byArea.map((item) => (
                <li key={item.id ?? 'none'} className="text-[13px]">
                  <div className="mb-1 flex justify-between gap-3">
                    <span>{item.label}</span>
                    <span className="tnum text-ink-faint">{formatDuration(item.minutes)}</span>
                  </div>
                  <ProgressBar
                    value={item.minutes / maxArea}
                    label={`${item.label} recorded time`}
                    tone="gold"
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">No recorded time this week.</p>
          )}
        </Card>
        <Card>
          <h3 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
            Time by project
          </h3>
          {report.byProject.length ? (
            <ul className="mt-2 flex flex-col gap-1 text-sm" aria-label="Recorded time by project">
              {report.byProject.slice(0, 8).map((item) => (
                <li key={item.id ?? 'none'} className="flex justify-between gap-3">
                  <span className="truncate">{item.label}</span>
                  <span className="tnum text-ink-faint">{formatDuration(item.minutes)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">No project time recorded.</p>
          )}
        </Card>
        <Card>
          <h3 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
            Reflection
          </h3>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-ink-faint">Mood</dt>
              <dd>{rating(report.reflections.moodAverage)}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">Stress</dt>
              <dd>{rating(report.reflections.stressAverage)}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">Sleep</dt>
              <dd>{rating(report.reflections.sleepAverage)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[12px] text-ink-faint">
            Based on {report.reflections.days} structured reflection
            {report.reflections.days === 1 ? '' : 's'}.
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            Energy: {report.energy.low} low · {report.energy.medium} medium · {report.energy.high}{' '}
            high.
          </p>
          {report.reflections.tags.length ? (
            <p className="mt-2 text-sm text-ink-muted">
              Common tags:{' '}
              {report.reflections.tags
                .slice(0, 5)
                .map((item) => `${item.tag} (${item.count})`)
                .join(', ')}
              .
            </p>
          ) : null}
        </Card>
      </div>
    </StepFrame>
  );
}
