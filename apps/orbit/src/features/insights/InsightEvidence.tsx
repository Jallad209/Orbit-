import type { CapacityEvidence, Insight, InsightEvidence as EvidenceRow } from '@orbit/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button, buttonVariants } from '@/components/ui/Button';
import { evidenceDestination, exclusionDestination, type Destination } from './insightRoutes';
import { formatInstant, formatMinutes, formatRange, formatRatio } from './format';

/**
 * The proof behind an observation, row by row. Large sets render in pages
 * with the total shown: every row is in the total, none is silently cut.
 * Rows are read-only; a destination opens the record or the day.
 */

export const EVIDENCE_PAGE_SIZE = 25;

interface Props {
  insight: Insight;
  onPreview: (destination: Extract<Destination, { kind: 'preview' }>) => void;
}

function Go({
  destination,
  onPreview,
}: {
  destination: Destination | null;
  onPreview: Props['onPreview'];
}) {
  if (!destination) return null;
  if (destination.kind === 'route') {
    return (
      <Link to={destination.to} className={buttonVariants({ size: 'sm', variant: 'ghost' })}>
        {destination.label}
      </Link>
    );
  }
  return (
    <Button size="sm" variant="ghost" onClick={() => onPreview(destination)}>
      {destination.label}
    </Button>
  );
}

function Capacity({ row, onPreview }: { row: CapacityEvidence; onPreview: Props['onPreview'] }) {
  return (
    <div className="flex flex-col gap-1">
      <p>
        <span className="font-medium text-ink">{row.date}</span>: working window{' '}
        {formatRange(row.workingWindow.startMin, row.workingWindow.endMin)} ({row.windowMin} min),
        minus {row.excludedMin} min excluded ={' '}
        <span className="tnum font-medium text-ink">{row.availableMin} min</span> available.
      </p>
      {row.exclusions.length ? (
        <ul className="ml-4 list-disc" aria-label={`Exclusions on ${row.date}`}>
          {row.exclusions.map((e, i) => (
            <li
              key={`${e.kind}-${e.refId ?? i}-${e.startMin}`}
              className="flex flex-wrap items-center gap-2"
            >
              <span>
                {e.kind === 'rest' ? 'Rest' : e.kind === 'event' ? 'Event' : 'Reserved'}: {e.label}{' '}
                {formatRange(e.startMin, e.endMin)} ({e.endMin - e.startMin} min)
              </span>
              <Go destination={exclusionDestination(e.kind, row.date)} onPreview={onPreview} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-faint">Nothing excluded on this date.</p>
      )}
      {row.areaReservations.length ? (
        <p className="text-ink-faint">
          Reserved for one area, still counted as work time:{' '}
          {row.areaReservations
            .map((r) => `${r.label} ${formatRange(r.startMin, r.endMin)}`)
            .join(', ')}
          .
        </p>
      ) : null}
    </div>
  );
}

function Row({
  row,
  insight,
  onPreview,
}: {
  row: EvidenceRow;
  insight: Insight;
  onPreview: Props['onPreview'];
}) {
  const destination = evidenceDestination(row, insight);
  switch (row.kind) {
    case 'task-actual':
      return (
        <>
          <span>
            <span className="font-medium text-ink">{row.title}</span> — estimated {row.estimateMin}{' '}
            min, recorded <span className="tnum">{row.actualMin} min</span> (
            {formatRatio(row.estimateMin ? row.actualMin / row.estimateMin : 0)}
            ), from {row.actualSource === 'actualMin' ? 'the recorded actual' : 'closed sessions'},
            completed {row.completedAt.slice(0, 10)}
          </span>
          <Go destination={destination} onPreview={onPreview} />
        </>
      );
    case 'activity':
      return (
        <>
          <span>
            Last activity:{' '}
            {row.ref.type === 'project'
              ? 'the project itself'
              : `${row.ref.type} “${row.title ?? ''}”`}
            {row.deleted ? ' (deleted)' : ''} on {formatInstant(row.at)}, {row.elapsedDays} day
            {row.elapsedDays === 1 ? '' : 's'} ago
          </span>
          <Go destination={destination} onPreview={onPreview} />
        </>
      );
    case 'block':
      return (
        <>
          <span>
            <span className="font-medium text-ink">{row.title}</span>{' '}
            {formatRange(row.startMin, row.endMin)} ·{' '}
            <span className="tnum">{row.minutes} min</span>
            {row.source === 'routine'
              ? ' · routine'
              : row.source === 'manual'
                ? ' · manual block'
                : ''}
            {row.finished ? ' · done' : ''}
            {row.outsideWindow ? ' · outside the working window' : ''}
          </span>
          <Go destination={destination} onPreview={onPreview} />
        </>
      );
    case 'unscheduled-task':
      return (
        <>
          <span>
            <span className="font-medium text-ink">{row.title}</span> — accepted for the day with no
            block left; counted once at <span className="tnum">{row.minutes} min</span>
            {row.estimateMin === 0
              ? ' (no estimate: the default applies)'
              : ` (estimate ${row.estimateMin} min)`}
          </span>
          <Go destination={destination} onPreview={onPreview} />
        </>
      );
    case 'capacity':
      return (
        <>
          <Capacity row={row} onPreview={onPreview} />
          <Go destination={destination} onPreview={onPreview} />
        </>
      );
    case 'area-target':
      return (
        <>
          <span>
            <span className="font-medium text-ink">{row.name}</span>: {row.weeklyHoursTarget} h a
            week = <span className="tnum">{row.minutes} min</span>
          </span>
          <Go destination={destination} onPreview={onPreview} />
        </>
      );
    case 'commitment':
      return (
        <>
          <span>
            <span className="font-medium text-ink">{row.text}</span> —{' '}
            {row.direction === 'owed-by-me' ? 'you owe' : 'owed to you'}
            {row.dueAt ? `, due ${row.dueAt.slice(0, 10)}` : ''}
          </span>
          <Go destination={destination} onPreview={onPreview} />
        </>
      );
  }
}

export function InsightEvidence({ insight, onPreview }: Props) {
  const [shown, setShown] = useState(EVIDENCE_PAGE_SIZE);
  const rows = insight.evidence;
  const visible = rows.slice(0, shown);
  const totals = summarize(insight);
  return (
    <div className="flex flex-col gap-2 text-[13px] text-ink-muted" data-testid="insight-evidence">
      {totals ? <p className="tnum">{totals}</p> : null}
      <ol className="flex flex-col gap-1.5" aria-label={`Evidence, ${rows.length} rows`}>
        {visible.map((row, i) => (
          <li
            key={rowKey(row, i)}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-2/60 px-2 py-1.5"
          >
            <Row row={row} insight={insight} onPreview={onPreview} />
          </li>
        ))}
      </ol>
      {rows.length > shown ? (
        <div className="flex items-center gap-2">
          <span>
            Showing {shown} of {rows.length}.
          </span>
          <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + EVIDENCE_PAGE_SIZE)}>
            Show more
          </Button>
        </div>
      ) : rows.length > EVIDENCE_PAGE_SIZE ? (
        <span>All {rows.length} rows shown.</span>
      ) : null}
      {insight.notes.length ? (
        <ul className="mt-1 flex flex-col gap-0.5 text-[12px] text-ink-faint" aria-label="Notes">
          {insight.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function rowKey(row: EvidenceRow, i: number): string {
  switch (row.kind) {
    case 'block':
      return `block-${row.blockId}`;
    case 'capacity':
      return `capacity-${row.date}`;
    case 'unscheduled-task':
      return `unscheduled-${row.ref.id}`;
    default:
      return `${row.kind}-${row.ref.id}-${i}`;
  }
}

/** The arithmetic behind the totals, so the rows reconcile to the title. */
function summarize(insight: Insight): string | null {
  const m = insight.metrics;
  switch (insight.kind) {
    case 'estimate-bias':
      return `Recorded ${formatMinutes(m.actualMin ?? 0)} ÷ estimated ${formatMinutes(m.estimateMin ?? 0)} = ${formatRatio(m.ratio ?? 0)} across ${m.samples ?? 0} tasks in the last ${m.windowDays ?? 0} days.`;
    case 'overloaded-day':
      return `${m.blocks ?? 0} blocks and ${m.unscheduled ?? 0} accepted-but-unscheduled tasks add up to ${m.demandMin ?? 0} min against ${m.availableMin ?? 0} min available.`;
    case 'weekly-target-deficit':
      return `Required ${m.requiredMin ?? 0} min − available ${m.availableMin ?? 0} min = ${m.deficitMin ?? 0} min short.`;
    case 'person-commitments':
      return `${m.open ?? 0} open: ${m.owedByMe ?? 0} you owe, ${m.owedToMe ?? 0} owed to you.`;
    case 'stale-project':
      return null;
  }
}
