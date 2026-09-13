import type { Clock, Id, LocalDate, PlanProposal } from '@orbit/core';
import { addDays, minuteOfDay, systemClock, toLocalDate } from '@orbit/core';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { Repository } from '@orbit/storage';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Card';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { useRepository } from '@/platform';
import { cn } from '@/lib/cn';
import { ReviewLaunchers } from '@/features/reviews/ReviewLaunchers';
import { CompactTimeline } from './CompactTimeline';
import { EnergyPicker } from './EnergyPicker';
import { FocusHeader } from './FocusHeader';
import { PlanPanel, type PlanDiff } from './PlanPanel';
import { settingsFor, usePlanPrefs } from './planSettings';
import {
  ActiveProjects,
  AtRiskPanel,
  InsightsStrip,
  TimeByArea,
  UpcomingCommitments,
} from './SidePanels';
import { acceptPlan, defaultPlanDate, loadToday, nextBlock, unplanDay } from './todayService';

export function diffProposals(previous: PlanProposal, current: PlanProposal): PlanDiff {
  const before = new Map(
    previous.blocks.filter((b) => b.taskId).map((b) => [b.taskId!, b.title] as const),
  );
  const after = new Set(current.blocks.filter((b) => b.taskId).map((b) => b.taskId!));
  return {
    added: new Set([...after].filter((id) => !before.has(id))),
    removed: [...before].filter(([id]) => !after.has(id)).map(([id, title]) => ({ id, title })),
  };
}

interface Props {
  clock?: Clock;
  /** Override the planned date (tests). Default: today, or tomorrow once the day is over. */
  date?: LocalDate;
}

/**
 * Home. Answers what matters, what to do next, what is at risk, where time
 * is going, and what is neglected. One dominant element (the next action),
 * the plan on the left, the timeline in the middle, signals on the right.
 */
export function TodayPage({ clock = systemClock, date: dateProp }: Props) {
  const repo = useRepository();
  const prefs = usePlanPrefs();
  const today = toLocalDate(clock.now());
  const [dateChoice, setDateChoice] = useState<LocalDate | null>(null);
  const date = dateProp ?? dateChoice ?? defaultPlanDate(clock.now(), prefs.workingWindow);
  const energy = prefs.energyByDate[date] ?? 'medium';

  const [excluded, setExcluded] = useState<readonly Id[]>([]);
  const [previous, setPrevious] = useState<PlanProposal | null>(null);
  const [replanChoice, setReplanChoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();
  // `?regenerate=1` (the "Regenerate today's proposal" command) opens in proposal
  // mode like the Re-plan button; accepting or clearing drops the parameter.
  const replanning = replanChoice || params.get('regenerate') === '1';
  const setReplanning = (on: boolean) => {
    setReplanChoice(on);
    if (!on && params.has('regenerate')) setParams({}, { replace: true });
  };

  const settings = useMemo(() => settingsFor(prefs, date, excluded), [prefs, date, excluded]);
  const query = useCallback(
    (r: Repository) => loadToday(r, { date, settings, clock }),
    [date, settings, clock],
  );
  const { data, loading, refresh } = useRepoQuery(query, [query]);

  const mode: 'proposal' | 'committed' = data?.commitment && !replanning ? 'committed' : 'proposal';
  const diff = useMemo(
    () => (previous && data ? diffProposals(previous, data.proposal) : null),
    [previous, data],
  );
  const nowMin = data?.isToday ? minuteOfDay(data.now) : null;
  const focus = data
    ? nextBlock(mode === 'committed' ? data.timeline : data.proposal.blocks, nowMin)
    : null;

  const accept = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await acceptPlan(repo, data.proposal, clock);
      setReplanning(false);
      setPrevious(null);
      toast({
        title: 'Plan committed',
        description: `${data.proposal.commitment.acceptedTaskIds.length} tasks for ${date === today ? 'today' : date}`,
        variant: 'success',
      });
    } finally {
      setBusy(false);
    }
  };

  const regenerate = () => {
    if (!data) return;
    setPrevious(data.proposal);
    refresh();
  };

  const replan = async () => {
    setReplanning(true);
    setPrevious(null);
  };

  const remove = (taskId: Id) => setExcluded((xs) => [...xs, taskId]);
  const restore = (taskId: Id) => setExcluded((xs) => xs.filter((x) => x !== taskId));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-display font-semibold tracking-tight text-ink">
            {date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : date}
          </h1>
          <p className="mt-1 text-ink-muted">
            {date === today
              ? 'What matters, what is next, what is at risk.'
              : 'The day is over; here is a start for tomorrow.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!dateProp ? (
            <div role="group" aria-label="Plan for" className="flex rounded-md border border-line">
              {[today, addDays(today, 1)].map((d, i) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={date === d}
                  onClick={() => setDateChoice(d)}
                  className={cn(
                    'h-8 px-3 text-[13px]',
                    i === 0 ? 'rounded-l-md' : 'rounded-r-md',
                    date === d ? 'bg-nav text-nav-fg' : 'text-ink-muted hover:bg-surface-2',
                  )}
                >
                  {i === 0 ? 'Today' : 'Tomorrow'}
                </button>
              ))}
            </div>
          ) : null}
          <EnergyPicker value={energy} onChange={(e) => prefs.setEnergy(date, e)} />
          {mode === 'committed' ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await unplanDay(repo, date);
                setReplanning(false);
                toast('Commitment cleared');
              }}
            >
              Clear commitment
            </Button>
          ) : null}
        </div>
      </div>

      {loading && !data ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-20" />
          <Skeleton className="h-64" />
        </div>
      ) : null}

      {data ? (
        <>
          <FocusHeader data={data} block={focus} mode={mode} clock={clock} />
          <InsightsStrip data={data} />
          <div className="grid gap-5 min-[900px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
            <div className="flex flex-col gap-5">
              <ReviewLaunchers
                date={date}
                now={data.now}
                hasCommitment={data.commitment !== null}
                eveningStartMin={prefs.eveningStartMin}
              />
              <PlanPanel
                proposal={data.proposal}
                mode={mode}
                committedBlocks={data.timeline}
                diff={diff}
                busy={busy}
                onRemove={remove}
                onRestore={restore}
                onAccept={accept}
                onRegenerate={regenerate}
                onReplan={replan}
              />
            </div>
            <div className="hidden min-[900px]:block">
              <CompactTimeline
                blocks={mode === 'committed' ? data.timeline : data.proposal.blocks}
                workingWindow={prefs.workingWindow}
                nowMin={nowMin}
              />
            </div>
            <details className="min-[900px]:hidden">
              <summary className="cursor-pointer text-[13px] text-ink-muted select-none">
                Timeline
              </summary>
              <div className="mt-2">
                <CompactTimeline
                  blocks={mode === 'committed' ? data.timeline : data.proposal.blocks}
                  workingWindow={prefs.workingWindow}
                  nowMin={nowMin}
                />
              </div>
            </details>
            <div className="flex flex-col gap-5">
              <AtRiskPanel data={data} />
              <ActiveProjects data={data} />
              <UpcomingCommitments data={data} />
              <TimeByArea data={data} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
