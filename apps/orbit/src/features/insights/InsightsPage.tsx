import type { DetectorCoverage, Insight, InsightSeverity } from '@orbit/core';
import { systemClock } from '@orbit/core';
import type { Clock } from '@orbit/core';
import { Lightbulb, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, SectionHeader, Skeleton } from '@/components/ui/Card';
import { toast } from '@/components/ui/toastStore';
import { useRepository } from '@/platform';
import { SearchPreview } from '@/features/search/SearchPreview';
import type { PreviewRef } from '@/features/search/searchActions';
import { InsightCard } from './InsightCard';
import { InsightHistory } from './InsightHistory';
import {
  dismissInsight,
  restoreInsight,
  snoozeInsight,
  type HistoryEntry,
  type SnoozeChoice,
} from './insightService';
import { useInsights } from './useInsights';
import { SEVERITY_LABEL, formatInstant } from './format';

const GROUPS: InsightSeverity[] = ['risk', 'attention', 'info'];

const KIND_LABEL = {
  'overloaded-day': 'overloaded days',
  'weekly-target-deficit': 'weekly targets',
  'stale-project': 'stale projects',
  'estimate-bias': 'estimate bias',
  'person-commitments': 'open commitments per person',
} as const;

/** What a detector could not judge, in plain words; null when it could. */
function coverageNote(c: DetectorCoverage): string | null {
  if (c.available) return null;
  if (c.kind === 'estimate-bias') {
    return `Estimate bias needs ${c.requiredSamples} completed tasks with an estimate and a recorded actual in one area; ${
      c.largestSample ? `the most any area has is ${c.largestSample}` : 'there are none yet'
    }.`;
  }
  switch (c.unavailableReason) {
    case 'no-targets':
      return 'Weekly targets: no area has a weekly hours target yet.';
    case 'no-subjects':
      return c.kind === 'stale-project'
        ? 'Stale projects: there are no active projects.'
        : c.kind === 'person-commitments'
          ? 'Open commitments: there are no people with open commitments.'
          : `${KIND_LABEL[c.kind]}: nothing to judge yet.`;
    default:
      return null;
  }
}

/**
 * /insights: what needs attention, grouped by severity, with the evidence
 * behind each observation, snooze and dismiss, and the history of what was
 * suppressed. Never says "everything is healthy": an empty list is
 * explained by what each detector could and could not judge.
 */
export function InsightsPage({ clock = systemClock }: { clock?: Clock }) {
  const repo = useRepository();
  const { view, loading, error, stale, refresh } = useInsights();
  const [params, setParams] = useSearchParams();
  const openKey = params.get('open');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRef | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  // A card named in the URL (the Timeline warning links here) gets focus once it exists.
  useEffect(() => {
    if (!openKey || !view) return;
    const card = listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(openKey)}"]`);
    card?.focus();
  }, [openKey, view]);

  /** After a card leaves, focus the next card in the list, else the list itself. */
  const focusAfter = (key: string) => {
    const cards = [
      ...(listRef.current?.querySelectorAll<HTMLElement>('[data-testid="insight-card"]') ?? []),
    ];
    const index = cards.findIndex((c) => c.dataset.key === key);
    const next = cards[index + 1] ?? cards[index - 1] ?? null;
    requestAnimationFrame(() => (next ?? listRef.current)?.focus());
  };

  const run = async (insight: Insight, action: () => Promise<unknown>, done: string) => {
    setBusyKey(insight.key);
    try {
      await action();
      focusAfter(insight.key);
      setAnnouncement(`${done}: ${insight.title}`);
      toast({
        title: done,
        description: insight.title,
        variant: 'neutral',
        action: {
          label: 'Restore',
          onClick: () => void restoreInsight(repo, insight.key, clock),
        },
      });
      if (openKey === insight.key) setParams({}, { replace: true });
    } catch (e) {
      toast({
        title: 'Could not save that',
        description: e instanceof Error ? e.message : String(e),
        variant: 'danger',
      });
    } finally {
      setBusyKey(null);
    }
  };

  const snooze = (insight: Insight, choice: SnoozeChoice) =>
    run(
      insight,
      () => snoozeInsight(repo, insight, choice, clock),
      choice === 'day'
        ? 'Snoozed for a day'
        : choice === 'week'
          ? 'Snoozed for a week'
          : 'Snoozed until its data changes',
    );
  const dismiss = (insight: Insight) =>
    run(insight, () => dismissInsight(repo, insight, clock), 'Dismissed');
  const restore = async (entry: HistoryEntry) => {
    setBusyKey(entry.key);
    try {
      await restoreInsight(repo, entry.key, clock);
      setAnnouncement(`Restored: ${entry.summary?.title ?? entry.key}`);
      toast({ title: 'Restored', description: entry.summary?.title, variant: 'success' });
    } catch (e) {
      toast({
        title: 'Could not restore',
        description: e instanceof Error ? e.message : String(e),
        variant: 'danger',
      });
    } finally {
      setBusyKey(null);
    }
  };

  const active = view?.active ?? [];
  const suppressedCount = view?.suppressed.length ?? 0;
  const notes = (view?.report.coverage ?? [])
    .map(coverageNote)
    .filter((n): n is string => n !== null);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-display font-semibold tracking-tight text-ink">Insights</h1>
          <p className="mt-1 text-ink-muted">
            What needs attention, with the records and arithmetic behind each observation.
          </p>
        </div>
        <div
          className="flex items-center gap-2 text-[12px] text-ink-faint"
          data-testid="insights-status"
        >
          {view ? <span>Computed {formatInstant(view.report.computedAt)}</span> : null}
          {loading ? <span aria-live="polite">Refreshing…</span> : null}
          <Button size="sm" variant="ghost" onClick={refresh} aria-label="Refresh insights">
            <RefreshCw className="size-3.5" aria-hidden="true" /> Refresh
          </Button>
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-soft/40 px-3 py-2 text-[13px] text-danger"
        >
          {stale
            ? 'The last refresh failed; the observations below are from before it. '
            : 'Insights could not be computed. '}
          {error.message}{' '}
          <Button size="sm" variant="secondary" onClick={refresh}>
            Retry
          </Button>
        </div>
      ) : null}

      {loading && !view ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : null}

      {view ? (
        <div
          ref={listRef}
          tabIndex={-1}
          className="flex flex-col gap-5 outline-none"
          data-testid="insights-list"
        >
          {active.length === 0 ? (
            <EmptyState
              icon={<Lightbulb />}
              title={
                suppressedCount
                  ? `${suppressedCount} observation${suppressedCount === 1 ? ' is' : 's are'} snoozed or dismissed`
                  : 'No observations from the current data'
              }
              description={
                suppressedCount
                  ? 'Nothing else needs attention right now. Restore anything below to see it again.'
                  : notes.length
                    ? 'Some checks could not run yet.'
                    : 'Every detector ran and found nothing above its threshold.'
              }
            />
          ) : (
            GROUPS.map((severity) => {
              const items = active.filter((i) => i.severity === severity);
              if (!items.length) return null;
              return (
                <section
                  key={severity}
                  aria-labelledby={`insights-${severity}`}
                  className="flex flex-col gap-2"
                >
                  <h2
                    id={`insights-${severity}`}
                    tabIndex={-1}
                    className="text-h3 font-medium text-ink outline-none"
                  >
                    {SEVERITY_LABEL[severity]}{' '}
                    <span className="text-ink-faint">({items.length})</span>
                  </h2>
                  {items.map((insight) => (
                    <InsightCard
                      key={insight.key}
                      insight={insight}
                      defaultOpen={insight.key === openKey}
                      busy={busyKey === insight.key}
                      onSnooze={snooze}
                      onDismiss={dismiss}
                      onPreview={(d) => setPreview(d.ref)}
                    />
                  ))}
                </section>
              );
            })
          )}
          {notes.length ? (
            <ul
              className="flex flex-col gap-1 text-[12px] text-ink-faint"
              aria-label="Checks that could not run"
              data-testid="insights-coverage"
            >
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          <Card>
            <SectionHeader title="History" meta={`${view.history.length} snoozed or dismissed`} />
            <InsightHistory entries={view.history} onRestore={restore} busyKey={busyKey} />
          </Card>
        </div>
      ) : null}

      <SearchPreview target={preview} onClose={() => setPreview(null)} clock={clock} />
    </div>
  );
}
