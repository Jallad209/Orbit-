import { describeRecurrence, systemClock, toLocalDate } from '@orbit/core';
import type { Clock } from '@orbit/core';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { routeFor } from '@/lib/destinations';
import type { StepSession } from '../useReviewSession';
import { loadBillsStep, payBillWithin } from '../weeklyService';
import { DeferButton, StepFrame } from './StepFrame';

/**
 * Step 5: unpaid bills that are overdue or due through the end of the
 * frozen target week, with the bills service behind every action. Mark
 * paid is the same atomic operation as on the Bills screen with the
 * receipt joining its transaction; a successor that falls inside the
 * period appears as a new item. Defer never pays or dismisses anything.
 */
export function BillsStep({
  session,
  clock = systemClock,
}: {
  session: StepSession;
  clock?: Clock;
}) {
  const { data } = useRepoQuery(
    (r) => loadBillsStep(r, session.review, clock),
    [session.review.revision, session.review.id],
  );
  if (!data) return <p className="text-sm text-ink-muted">Loading…</p>;
  const items = data.due.map((b) => ({ type: 'bill' as const, id: b.id }));
  const today = toLocalDate(clock.now());
  return (
    <StepFrame
      session={session}
      items={items}
      fingerprint={data.fingerprint}
      intro={`Bills overdue or due through ${data.periodEnd}, the end of the week being planned. Mark paid, open one to edit or stop its schedule, or defer it — deferring neither pays nor silences its reminder.`}
      gate="Pay, edit, or defer them."
    >
      {data.due.length === 0 ? (
        <p className="text-[13px] text-ink-faint">Nothing due in this period.</p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {data.due.map((bill) => {
          const ref = { type: 'bill' as const, id: bill.id };
          const decided = session.decided.has(`bill:${bill.id}`);
          return (
            <li
              key={bill.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2 text-sm"
              data-testid="review-bill"
              data-decided={decided}
            >
              <Link
                to={routeFor({ type: 'bill', id: bill.id })!}
                className="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {bill.title}
              </Link>
              <span className="tnum">
                {bill.amount} {bill.currency || '(currency not set)'}
              </span>
              <Badge tone={bill.dueAt < today ? 'danger' : 'outline'}>due {bill.dueAt}</Badge>
              {bill.recurrence ? (
                <Badge tone="outline">
                  {describeRecurrence(bill.recurrence, bill.recurrenceAnchor)}
                </Badge>
              ) : null}
              {decided ? (
                <Badge tone="ok">decided</Badge>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={session.busy || session.stale}
                    onClick={() =>
                      void session
                        .submit(
                          'pay-bill',
                          [ref],
                          data.fingerprint,
                          { paidAt: clock.now().toISOString() },
                          (tx) => payBillWithin(tx, bill.id, clock.now().toISOString(), clock),
                        )
                        .then((r) => {
                          if (!r) return;
                          const successorDueAt = r.result.successorDueAt as string | null;
                          toast({
                            title: r.replayed ? 'Already paid' : 'Marked paid',
                            description: successorDueAt
                              ? `Next occurrence due ${successorDueAt}.`
                              : 'No further occurrence.',
                            variant: 'success',
                          });
                        })
                    }
                  >
                    Mark paid
                  </Button>
                  <DeferButton session={session} target={ref} fingerprint={data.fingerprint} />
                </>
              )}
            </li>
          );
        })}
      </ul>
      {data.recentPaid.length ? (
        <p className="text-[12px] text-ink-faint">
          Recently paid:{' '}
          {data.recentPaid
            .map((b) => `${b.title} (${b.paidAt ? b.paidAt.slice(0, 10) : 'time not recorded'})`)
            .join(', ')}
          .
        </p>
      ) : null}
    </StepFrame>
  );
}
