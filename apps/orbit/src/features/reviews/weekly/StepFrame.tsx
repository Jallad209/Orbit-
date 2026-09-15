import type { ReviewRef } from '@orbit/core';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { StepSession } from '../useReviewSession';

export function refKey(ref: ReviewRef): string {
  return `${ref.type}:${ref.id}`;
}

interface Props {
  session: StepSession;
  /** Every item the step currently shows. */
  items: ReviewRef[];
  fingerprint: string;
  intro: ReactNode;
  children: ReactNode;
  /** The gate text shown while items still need a decision. */
  gate: string;
}

/**
 * The frame every step shares: an intro, the items, the gate that counts
 * what still needs a decision, "Defer all remaining", and the
 * acknowledgement that records the step's outcome with the counts and the
 * fingerprint of what was shown. Acknowledging is not a cleanup: deferred
 * items stay deferred and are named in the summary.
 */
export function StepFrame({ session, items, fingerprint, intro, children, gate }: Props) {
  const [reason, setReason] = useState('');
  const remaining = items.filter((r) => !session.decided.has(refKey(r)));
  const deferred = session.receipts.filter(
    (a) => a.step === session.step && a.kind === 'defer',
  ).length;
  const resolved = session.receipts.filter(
    (a) => a.step === session.step && a.kind !== 'defer' && a.kind !== 'acknowledge',
  ).length;
  const outcome = session.review.steps.find((s) => s.step === session.step);

  const deferAll = async () => {
    for (const ref of remaining) {
      if (!(await session.defer(ref, fingerprint, reason.trim() || undefined))) return;
    }
  };

  const ack = async () => {
    await session.acknowledgeStep({
      status: deferred > 0 ? 'deferred' : 'done',
      fingerprint,
      resolved,
      deferred,
      remaining: remaining.length,
      reason: reason.trim(),
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid={`step-${session.step}`}>
      <p className="text-sm text-ink-muted">{intro}</p>
      {session.stale ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-gold-2 bg-gold-2/20 px-3 py-2 text-[13px]"
        >
          <span className="flex-1">
            This review moved in another window. Your inputs here are kept.
          </span>
          <Button size="sm" variant="secondary" onClick={session.refresh}>
            Refresh
          </Button>
        </div>
      ) : null}
      {children}
      <div className="flex flex-col gap-2 border-t border-line pt-3" data-testid="step-gate">
        <p className="text-[13px] text-ink-muted">
          {items.length === 0
            ? 'Nothing here needs a decision.'
            : remaining.length === 0
              ? `Every item has a decision: ${resolved} acted on, ${deferred} deferred.`
              : `${remaining.length} of ${items.length} still need${remaining.length === 1 ? 's' : ''} a decision. ${gate}`}
          {outcome
            ? ` Acknowledged ${outcome.status === 'deferred' ? 'with deferrals' : 'as done'} at ${outcome.at.slice(11, 16)}.`
            : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Reason for deferring (optional)"
            placeholder="Reason for deferring (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-8 max-w-xs"
          />
          {remaining.length ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void deferAll()}
              disabled={session.busy || session.stale}
            >
              Defer all remaining ({remaining.length})
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="primary"
            onClick={() => void ack()}
            disabled={remaining.length > 0 || session.busy || session.stale}
            data-testid="acknowledge-step"
          >
            {outcome ? 'Acknowledge again and continue' : 'Acknowledge and continue'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DeferButton({
  session,
  target,
  fingerprint,
}: {
  session: StepSession;
  target: ReviewRef;
  fingerprint: string;
}) {
  const done = session.decided.has(refKey(target));
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => void session.defer(target, fingerprint)}
      disabled={done || session.busy || session.stale}
    >
      {done ? 'Decided' : 'Defer'}
    </Button>
  );
}
