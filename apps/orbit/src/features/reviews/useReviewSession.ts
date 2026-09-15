import { newId, systemClock } from '@orbit/core';
import type {
  Clock,
  Id,
  ReviewRef,
  WeeklyReview,
  WeeklyReviewAction,
  WeeklyReviewActionKind,
  WeeklyReviewStep,
  WeeklyReviewStepOutcome,
} from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from '@/components/ui/toastStore';
import { bumpData, useRepoQuery } from '@/data/useQuery';
import { useRepository } from '@/platform';
import {
  WeeklyReviewError,
  acknowledge,
  decidedRefs,
  goToStep,
  loadReceipts,
  submitAction,
  type SubmitResult,
} from './weeklyService';

export interface StepSession {
  review: WeeklyReview;
  step: WeeklyReviewStep;
  receipts: WeeklyReviewAction[];
  /** `type:id` of every ref this step already decided. */
  decided: Set<string>;
  /** Stale revision: another window moved the review; inputs are kept, refresh needed. */
  stale: boolean;
  busy: boolean;
  submit: <T extends Record<string, unknown>>(
    kind: WeeklyReviewActionKind,
    refs: ReviewRef[],
    fingerprint: string,
    choice: Record<string, unknown>,
    perform: (tx: Repository, review: WeeklyReview) => Promise<T>,
  ) => Promise<SubmitResult<T> | null>;
  defer: (ref: ReviewRef, fingerprint: string, reason?: string) => Promise<boolean>;
  acknowledgeStep: (outcome: Omit<WeeklyReviewStepOutcome, 'at' | 'step'>) => Promise<boolean>;
  goTo: (step: WeeklyReviewStep) => Promise<boolean>;
  refresh: () => void;
}

/**
 * One review's session for the current step: the receipts already
 * recorded, an action-id per request that a retry reuses, and the shared
 * stale-revision handling. Every write goes through `submitAction`, so a
 * receipt and its domain change commit together.
 */
export function useReviewSession(
  review: WeeklyReview,
  step: WeeklyReviewStep,
  onReview: (review: WeeklyReview) => void,
  clock: Clock = systemClock,
): StepSession {
  const repo = useRepository();
  const { data: receiptsPage, refresh } = useRepoQuery(
    (r) => loadReceipts(r, review.id, { limit: 1000 }),
    [review.id],
  );
  const receipts = useMemo(() => receiptsPage?.rows ?? [], [receiptsPage]);
  const decided = useMemo(() => decidedRefs(receipts, step), [receipts, step]);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Action ids keyed by request so a retry after an uncertain response reuses the id. */
  const ids = useRef(new Map<string, Id>());

  const handle = useCallback((e: unknown, title: string) => {
    if (e instanceof WeeklyReviewError && e.code === 'stale-revision') {
      setStale(true);
      toast({
        title: 'This review changed in another window',
        description: e.message,
        variant: 'warning',
      });
      return;
    }
    toast({ title, description: e instanceof Error ? e.message : String(e), variant: 'danger' });
  }, []);

  const submit = useCallback<StepSession['submit']>(
    async (kind, refs, fingerprint, choice, perform) => {
      const key = `${kind}:${refs.map((r) => `${r.type}:${r.id}`).join(',')}:${JSON.stringify(choice)}`;
      const actionId = ids.current.get(key) ?? newId();
      ids.current.set(key, actionId);
      setBusy(true);
      try {
        const result = await submitAction(
          repo,
          {
            reviewId: review.id,
            revision: review.revision,
            actionId,
            step,
            kind,
            refs,
            fingerprint,
            choice,
          },
          perform,
          clock,
        );
        ids.current.delete(key);
        onReview(result.review);
        refresh();
        return result;
      } catch (e) {
        handle(e, 'Could not record that');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [repo, review.id, review.revision, step, clock, onReview, refresh, handle],
  );

  const defer = useCallback<StepSession['defer']>(
    async (ref, fingerprint, reason) =>
      (await submit('defer', [ref], fingerprint, reason ? { reason } : {}, async () => ({}))) !==
      null,
    [submit],
  );

  const acknowledgeStep = useCallback<StepSession['acknowledgeStep']>(
    async (outcome) => {
      setBusy(true);
      try {
        onReview(await acknowledge(repo, review.id, review.revision, { ...outcome, step }, clock));
        return true;
      } catch (e) {
        handle(e, 'Could not acknowledge the step');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [repo, review.id, review.revision, step, clock, onReview, handle],
  );

  const goTo = useCallback<StepSession['goTo']>(
    async (target) => {
      try {
        onReview(await goToStep(repo, review.id, review.revision, target, clock));
        return true;
      } catch (e) {
        handle(e, 'Could not move');
        return false;
      }
    },
    [repo, review.id, review.revision, clock, onReview, handle],
  );

  return {
    review,
    step,
    receipts,
    decided,
    stale,
    busy,
    submit,
    defer,
    acknowledgeStep,
    goTo,
    refresh: () => {
      setStale(false);
      // Every query re-reads, including the review record another window advanced.
      bumpData();
      refresh();
    },
  };
}
