import { STEP_LABEL, WEEKLY_REVIEW_STEPS, stepIndex, systemClock } from '@orbit/core';
import type { Clock, WeeklyReview, WeeklyReviewStep } from '@orbit/core';
import { Check, Pause } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonVariants } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { useDraftRegistration } from '@/features/drafts/DraftGuard';
import { cn } from '@/lib/cn';
import { routeFor } from '@/lib/destinations';
import { useRepository } from '@/platform';
import { useReviewSession } from './useReviewSession';
import { BillsStep } from './weekly/BillsStep';
import { CapacityStep } from './weekly/CapacityStep';
import { GoalsStep } from './weekly/GoalsStep';
import { InboxStep } from './weekly/InboxStep';
import { OverdueStep, toDraft, type OverdueChoices } from './weekly/OverdueStep';
import { ProjectsStep } from './weekly/ProjectsStep';
import {
  WeeklyReviewError,
  finishReview,
  loadLanding,
  loadReceipts,
  loadReview,
  pauseReview,
  resumeReview,
  startReview,
  type FinishCheck,
} from './weeklyService';

function report(title: string, e: unknown): void {
  toast({ title, description: e instanceof Error ? e.message : String(e), variant: 'danger' });
}

/**
 * `/review/weekly`: the landing (start, resume, history, review again)
 * and, with `?review=`, the six-step flow. Opening a URL never starts a
 * review or submits anything; Start and Resume are the user's explicit
 * intent. A completed review opens read-only with its frozen summary.
 */
export function WeeklyFlow({ clock = systemClock }: { clock?: Clock }) {
  const [params] = useSearchParams();
  const id = params.get('review');
  if (!id) return <WeeklyLanding clock={clock} />;
  return <WeeklyReviewLoader id={id} clock={clock} />;
}

function WeeklyLanding({ clock }: { clock: Clock }) {
  const repo = useRepository();
  const navigate = useNavigate();
  const { data, loading, error } = useRepoQuery((r) => loadLanding(r, clock), []);
  const [busy, setBusy] = useState(false);
  const open = (review: WeeklyReview) =>
    void navigate(routeFor({ type: 'review', id: review.id })!);
  const start = async (startNew: boolean) => {
    setBusy(true);
    try {
      open(await startReview(repo, { startNew, clock }));
    } catch (e) {
      report('Could not start the review', e);
    } finally {
      setBusy(false);
    }
  };
  if (error)
    return (
      <p role="alert" className="text-sm text-danger">
        The weekly review could not be loaded: {error.message}
      </p>
    );
  if (!data) return loading ? <p className="text-sm text-ink-muted">Loading…</p> : null;
  const { active, others, completed, thisWeek } = data;
  const isOld = active ? active.reviewWeekStart !== thisWeek.reviewWeekStart : false;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" data-testid="weekly-landing">
      <div>
        <h1 className="text-display font-semibold tracking-tight text-ink">Weekly review</h1>
        <p className="mt-1 text-ink-muted">
          Six steps — inbox, overdue work, projects, goals and targets, bills, next week — with
          every decision recorded. Pause any time; resume where you left off.
        </p>
      </div>
      {active ? (
        <Card className="flex flex-col gap-2" data-testid="landing-active">
          <p className="text-sm text-ink">
            An unfinished review of the week of {active.reviewWeekStart} (planning{' '}
            {active.targetWeekStart}) is at step “{STEP_LABEL[active.currentStep]}”
            {active.status === 'paused' && active.pausedAt
              ? `, paused ${active.pausedAt.slice(0, 16).replace('T', ' ')}`
              : ''}
            .
          </p>
          {isOld ? (
            <p className="text-[13px] text-gold-ink">
              That period is older than this week ({thisWeek.reviewWeekStart}). Resuming keeps its
              original dates; you can also start this week's review and leave it be.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void resumeReview(repo, active.id, clock).then(open, (e) =>
                  report('Could not resume', e),
                )
              }
            >
              Resume
            </Button>
            {isOld ? (
              <Button variant="secondary" disabled={busy} onClick={() => void start(true)}>
                Start this week
              </Button>
            ) : null}
          </div>
        </Card>
      ) : (
        <div>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void start(false)}
            data-testid="start-review"
          >
            Start this week's review ({thisWeek.reviewWeekStart} → planning{' '}
            {thisWeek.targetWeekStart})
          </Button>
        </div>
      )}
      {others.length ? (
        <Card className="flex flex-col gap-2" data-testid="landing-duplicates">
          <p className="text-sm text-ink">
            {others.length} other unfinished review{others.length === 1 ? '' : 's'} exist (an import
            can bring duplicates). Nothing is merged; open any of them.
          </p>
          <ul className="flex flex-col gap-1 text-[13px]">
            {others.map((r) => (
              <li key={r.id}>
                <button type="button" className="underline" onClick={() => open(r)}>
                  Week of {r.reviewWeekStart}, at “{STEP_LABEL[r.currentStep]}”
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <section aria-label="Completed reviews">
        <h2 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
          History
        </h2>
        {completed.length === 0 ? (
          <p className="mt-1 text-[13px] text-ink-faint">No completed reviews yet.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {completed.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2 text-sm"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left hover:underline"
                  onClick={() => open(r)}
                >
                  Week of {r.reviewWeekStart} · completed {r.completedAt?.slice(0, 10)}
                </button>
                <Badge tone="outline">{r.summary?.actionCount ?? 0} actions</Badge>
                <Badge tone={(r.summary?.items.length ?? 0) > 0 ? 'gold' : 'ok'}>
                  {r.summary?.items.length ?? 0} unresolved
                </Badge>
                {r.reviewWeekStart === thisWeek.reviewWeekStart && !active ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void start(true)}
                  >
                    Review again
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function WeeklyReviewLoader({ id, clock }: { id: string; clock: Clock }) {
  const { data, loading, error } = useRepoQuery((r) => loadReview(r, id), [id]);
  const [local, setLocal] = useState<WeeklyReview | null>(null);
  // The freshest record wins: a write from this window returns it directly; a read after a
  // bump brings the other window's version. Derived from revision, never from timing.
  const review = local && data && local.revision >= data.revision ? local : (data ?? local);
  if (error)
    return (
      <p role="alert" className="text-sm text-danger">
        This review could not be loaded: {error.message}
      </p>
    );
  if (!review) {
    if (loading) return <p className="text-sm text-ink-muted">Loading…</p>;
    return (
      <EmptyState
        title="That review no longer exists"
        description="It was deleted, or the link is from data that is no longer here. Nothing was started."
        action={
          <Link to="/review/weekly" className="text-sm underline">
            Back to the weekly review
          </Link>
        }
      />
    );
  }
  if (review.deletedAt !== null) {
    return (
      <EmptyState
        title="This review was deleted"
        description="Its history is gone; the work it recorded is untouched."
        action={
          <Link to="/review/weekly" className="text-sm underline">
            Back
          </Link>
        }
      />
    );
  }
  if (review.status === 'completed') return <CompletedReview review={review} />;
  return <ReviewSteps key={review.id} review={review} onReview={setLocal} clock={clock} />;
}

function ReviewSteps({
  review,
  onReview,
  clock,
}: {
  review: WeeklyReview;
  onReview: (r: WeeklyReview) => void;
  clock: Clock;
}) {
  const repo = useRepository();
  const navigate = useNavigate();
  const step = review.currentStep;
  const session = useReviewSession(review, step, onReview, clock);
  const [finish, setFinish] = useState<FinishCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const overdueChoices = useRef<OverdueChoices>({});
  const [pendingChoices, setPendingChoices] = useState(0);
  const onDraftChange = useCallback((choices: OverdueChoices) => {
    overdueChoices.current = choices;
    setPendingChoices(Object.keys(choices).length);
  }, []);
  // Choices belong to the overdue step; elsewhere there is nothing pending. Derived, not synced.
  const pending = step === 'overdue' ? pendingChoices : 0;

  const pause = async (): Promise<boolean> => {
    setBusy(true);
    try {
      const draft =
        step === 'overdue' && pendingChoices > 0 ? toDraft(overdueChoices.current) : null;
      const paused = await pauseReview(repo, review.id, review.revision, draft, clock);
      onReview(paused);
      toast({
        title: 'Paused',
        description: draft
          ? `${draft.choices.length} unapplied choice${draft.choices.length === 1 ? '' : 's'} saved for next time.`
          : 'Progress saved.',
        variant: 'success',
      });
      return true;
    } catch (e) {
      if (e instanceof WeeklyReviewError && e.code === 'stale-revision')
        report('Could not pause', e);
      else report('Could not pause', e);
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Unapplied overdue choices are a draft: leaving the flow asks to save (pause) or discard.
  useDraftRegistration({
    key: `review:${review.id}`,
    label: 'Weekly review choices',
    dirty: pending > 0,
    status: pending > 0 ? 'editing' : 'saved',
    flush: async () =>
      (await pause()) ? { ok: true } : { ok: false, reason: 'Pause did not save.' },
    discard: () => {
      overdueChoices.current = {};
      setPendingChoices(0);
    },
  });

  const tryFinish = async () => {
    setBusy(true);
    try {
      const result = await finishReview(repo, review.id, review.revision, clock);
      if (result.review.status === 'completed') {
        onReview(result.review);
        toast({
          title: 'Review finished',
          description: `${result.check.unresolved.length} item${result.check.unresolved.length === 1 ? '' : 's'} left deferred.`,
          variant: 'success',
        });
        void navigate(routeFor({ type: 'review', id: review.id })!);
        return;
      }
      setFinish(result.check);
    } catch (e) {
      report('Could not finish', e);
    } finally {
      setBusy(false);
    }
  };

  const outcomeFor = (s: WeeklyReviewStep) => review.steps.find((o) => o.step === s);
  const allAcknowledged = WEEKLY_REVIEW_STEPS.every((s) => outcomeFor(s));

  return (
    <div
      className="mx-auto flex max-w-4xl flex-col gap-5"
      data-testid="weekly-flow"
      data-step={step}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-display font-semibold tracking-tight text-ink">Weekly review</h1>
          <p className="mt-1 text-ink-muted">
            Week of {review.reviewWeekStart}, planning the week of {review.targetWeekStart}.
            {review.status === 'paused' ? ' Resumed.' : ''}
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void pause().then((ok) => ok && navigate('/review/weekly'))}
          disabled={busy}
          data-testid="pause-review"
        >
          <Pause className="size-4" aria-hidden="true" /> Pause
        </Button>
      </div>

      <ol className="flex flex-wrap items-center gap-2 text-[13px]" aria-label="Steps">
        {WEEKLY_REVIEW_STEPS.map((s, i) => {
          const outcome = outcomeFor(s);
          const active = s === step;
          return (
            <li key={s} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void session.goTo(s)}
                aria-current={active ? 'step' : undefined}
                data-testid={`step-tab-${s}`}
                data-outcome={outcome?.status ?? 'pending'}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2 py-1',
                  active ? 'bg-nav text-nav-fg' : 'text-ink hover:bg-surface-2',
                )}
              >
                <span
                  className={cn(
                    'grid size-5 place-items-center rounded-full text-[11px] font-semibold',
                    active
                      ? 'bg-lime text-lime-ink'
                      : outcome
                        ? outcome.status === 'deferred'
                          ? 'bg-gold text-gold-ink'
                          : 'bg-lime-ink text-lime'
                        : 'border border-line text-ink-faint',
                  )}
                  aria-hidden="true"
                >
                  {outcome && !active ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                </span>
                {STEP_LABEL[s]}
                {outcome ? (
                  <span className="sr-only">
                    {outcome.status === 'deferred' ? ', acknowledged with deferrals' : ', done'}
                  </span>
                ) : null}
              </button>
              {i < WEEKLY_REVIEW_STEPS.length - 1 ? (
                <span aria-hidden="true" className="h-px w-4 bg-line" />
              ) : null}
            </li>
          );
        })}
      </ol>

      <section aria-label={STEP_LABEL[step]} className="flex flex-col gap-4">
        <h2 className="text-h1 font-semibold tracking-tight text-ink">
          {stepIndex(step) + 1}. {STEP_LABEL[step]}
        </h2>
        {step === 'inbox' ? <InboxStep session={session} clock={clock} /> : null}
        {step === 'overdue' ? (
          <OverdueStep
            session={session}
            draft={review.stepDraft}
            onDraftChange={onDraftChange}
            clock={clock}
          />
        ) : null}
        {step === 'projects' ? <ProjectsStep session={session} clock={clock} /> : null}
        {step === 'goals' ? <GoalsStep session={session} clock={clock} /> : null}
        {step === 'bills' ? <BillsStep session={session} clock={clock} /> : null}
        {step === 'capacity' ? <CapacityStep session={session} clock={clock} /> : null}
      </section>

      {step === 'capacity' ? (
        <Card className="flex flex-col gap-3" data-testid="finish-panel">
          <h3 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
            Finish
          </h3>
          {finish ? (
            <div className="flex flex-col gap-2 text-sm" data-testid="finish-check">
              {finish.missing.length ? (
                <p>Not yet acknowledged: {finish.missing.map((s) => STEP_LABEL[s]).join(', ')}.</p>
              ) : null}
              {finish.changed.length ? (
                <p>
                  Changed since reviewed: {finish.changed.map((s) => STEP_LABEL[s]).join(', ')}.
                  Revisit and acknowledge again; the earlier acknowledgement was dropped rather than
                  kept as if nothing changed.
                </p>
              ) : null}
              {finish.unresolved.length ? (
                <p>
                  {finish.unresolved.length} deferred item
                  {finish.unresolved.length === 1 ? '' : 's'} will be listed in the summary.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {[...finish.missing, ...finish.changed].map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant="secondary"
                    onClick={() => void session.goTo(s)}
                  >
                    Go to {STEP_LABEL[s]}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-ink-muted">
              {allAcknowledged
                ? 'Every step is acknowledged. Finishing rechecks that nothing changed underneath, lists what was deferred, and freezes the summary.'
                : `Acknowledge every step first (${WEEKLY_REVIEW_STEPS.filter((s) => !outcomeFor(s))
                    .map((s) => STEP_LABEL[s])
                    .join(', ')} remain).`}
            </p>
          )}
          <div>
            <Button
              variant="primary"
              onClick={() => void tryFinish()}
              disabled={busy || !allAcknowledged}
              data-testid="finish-review"
            >
              Finish review
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function CompletedReview({ review }: { review: WeeklyReview }) {
  const { data: receipts } = useRepoQuery(
    (r) => loadReceipts(r, review.id, { limit: 200 }),
    [review.id],
  );
  const s = review.summary;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5" data-testid="completed-review">
      <div>
        <Link to="/review/weekly" className="text-[13px] text-ink-muted hover:underline">
          ← Weekly review
        </Link>
        <h1 className="mt-1 text-display font-semibold tracking-tight text-ink">
          Review of the week of {review.reviewWeekStart}
        </h1>
        <p className="mt-1 text-ink-muted">
          Completed {review.completedAt?.slice(0, 16).replace('T', ' ')}; planned the week of{' '}
          {review.targetWeekStart}. This record does not change when your tasks do.
        </p>
      </div>
      <Card className="grid gap-3 md:grid-cols-3">
        <div>
          <p className="text-[12px] text-ink-faint">Actions recorded</p>
          <p className="text-h2 font-semibold tnum">{s?.actionCount ?? 0}</p>
        </div>
        <div>
          <p className="text-[12px] text-ink-faint">Deferred / unresolved</p>
          <p className="text-h2 font-semibold tnum">{s?.items.length ?? 0}</p>
        </div>
        <div>
          <p className="text-[12px] text-ink-faint">Next week (at finish)</p>
          <p className="text-sm">
            {s?.capacity
              ? `${(s.capacity.bookedMin / 60).toFixed(1)} h booked, ${(s.capacity.targetMin / 60).toFixed(1)} h of targets, ${(s.capacity.availableMin / 60).toFixed(1)} h available; ${s.capacity.overloadedDays} overloaded day${s.capacity.overloadedDays === 1 ? '' : 's'}`
              : '—'}
          </p>
        </div>
      </Card>
      <section aria-label="Steps">
        <h2 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">Steps</h2>
        <ul className="mt-1 flex flex-col gap-1 text-sm">
          {(s?.steps ?? review.steps).map((o) => (
            <li
              key={o.step}
              className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-1.5"
            >
              <span className="w-40 font-medium">{STEP_LABEL[o.step]}</span>
              <Badge tone={o.status === 'deferred' ? 'gold' : 'ok'}>{o.status}</Badge>
              <span className="text-[12px] text-ink-faint">
                {o.resolved} acted on · {o.deferred} deferred{o.reason ? ` · ${o.reason}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {s?.items.length ? (
        <section aria-label="Unresolved items">
          <h2 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
            Deferred and unresolved
          </h2>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {s.items.map((it) => (
              <li key={`${it.ref.type}:${it.ref.id}`} className="flex items-center gap-2">
                <Badge tone="outline">{STEP_LABEL[it.step]}</Badge>
                <span className="truncate">
                  {it.label || `${it.ref.type} ${it.ref.id.slice(0, 8)}`}
                </span>
                <Badge tone="gold">{it.status}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-label="Decision history">
        <h2 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
          Decisions ({receipts?.total ?? 0})
        </h2>
        <ul className="mt-1 flex flex-col gap-0.5 text-[13px]" data-testid="receipts">
          {receipts?.rows.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <span className="w-24 text-ink-faint tnum">
                {a.at.slice(5, 16).replace('T', ' ')}
              </span>
              <Badge tone="outline">{STEP_LABEL[a.step]}</Badge>
              <span>{a.kind}</span>
              <span className="truncate text-ink-faint">
                {a.refs.map((r) => `${r.type} ${r.id.slice(0, 8)}`).join(', ')}
              </span>
            </li>
          ))}
        </ul>
        {receipts && receipts.total > receipts.rows.length ? (
          <p className="text-[12px] text-ink-faint">
            Showing the first {receipts.rows.length} of {receipts.total}.
          </p>
        ) : null}
      </section>
      <Link to="/review/weekly" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
        Back to the weekly review
      </Link>
    </div>
  );
}
