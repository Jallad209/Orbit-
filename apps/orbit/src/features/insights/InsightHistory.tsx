import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Card';
import type { HistoryEntry } from './insightService';
import { SEVERITY_LABEL, SEVERITY_TONE, formatInstant } from './format';

interface Props {
  entries: HistoryEntry[];
  onRestore: (entry: HistoryEntry) => void;
  busyKey?: string | null;
}

function status(entry: HistoryEntry): string {
  switch (entry.status) {
    case 'dismissed':
      return `Dismissed ${formatInstant(entry.state.dismissedAt ?? entry.state.updatedAt)}`;
    case 'snoozed-until':
      return `Snoozed until ${formatInstant(entry.until ?? entry.state.updatedAt)}`;
    case 'until-change':
      return `Snoozed until its data changes (since ${formatInstant(entry.state.updatedAt)})`;
  }
}

/**
 * Dismissed and currently snoozed observations, with when and how, and a
 * Restore action. An entry from before week 11 has no summary; it is shown
 * as a previously dismissed observation rather than invented.
 */
export function InsightHistory({ entries, onRestore, busyKey = null }: Props) {
  if (!entries.length) {
    return (
      <EmptyState
        title="No history"
        description="Snoozed and dismissed observations are listed here so they can be restored."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="History" data-testid="insight-history">
      {entries.map((entry) => {
        const summary = entry.summary;
        return (
          <li
            key={entry.state.id}
            className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2"
            data-key={entry.key}
          >
            {summary ? (
              <Badge tone={SEVERITY_TONE[summary.severity]}>
                {SEVERITY_LABEL[summary.severity]}
              </Badge>
            ) : (
              <Badge tone="outline">Earlier</Badge>
            )}
            {/* See InsightCard: a zero-basis `flex-1` beside a badge and a button collapses
                to a few pixels at 400% zoom instead of wrapping onto its own line. */}
            <div className="min-w-[11rem] flex-1">
              <p className="text-[13px] text-ink">
                {summary ? summary.title : 'A previously dismissed observation'}
              </p>
              <p className="text-[12px] text-ink-faint">
                {status(entry)}
                {entry.live ? ' · still applies today' : summary ? ' · no longer applies' : ''}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={busyKey === entry.key}
              aria-label={`Restore: ${summary ? summary.title : entry.key}`}
              onClick={() => onRestore(entry)}
            >
              Restore
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
