import { DUE_SOON_DAYS, describeRecurrence, systemClock, toLocalDate } from '@orbit/core';
import type { Bill, Clock } from '@orbit/core';
import { Receipt } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, SectionHeader, Skeleton } from '@/components/ui/Card';
import { Select } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { useRepository } from '@/platform';
import { routeFor } from '@/lib/destinations';
import { BillForm } from './BillForm';
import { createBill, loadBills, restoreBill, type BillsView } from './billsService';

/** Sums per currency as text; an empty currency is "currency not set", never merged in. */
export function formatTotals(totals: Array<{ currency: string; total: number }>): string {
  if (!totals.length) return '';
  return totals
    .map((t) => `${t.total.toFixed(2)} ${t.currency || '(currency not set)'}`)
    .join(' · ');
}

/**
 * Bills grouped by what needs attention: overdue, due within the fixed
 * three-date window, upcoming, then paid history and an explicit deleted
 * view. Totals are per currency. The groups follow the local date, so
 * they move at midnight and when the window comes back.
 */
export function BillsPage({ clock = systemClock }: { clock?: Clock }) {
  const repo = useRepository();
  const [tick, setTick] = useState(0);
  const { data, loading, error } = useRepoQuery((r) => loadBills(r, clock), [tick]);
  const [showPaid, setShowPaid] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [series, setSeries] = useState('');
  const [busy, setBusy] = useState(false);

  // Date-sensitive groups: recompute at local midnight and whenever the window regains focus.
  useEffect(() => {
    const now = clock.now();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    const timer = setTimeout(() => setTick((t) => t + 1), midnight.getTime() - now.getTime());
    const onFocus = () => setTick((t) => t + 1);
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [clock, tick]);

  const seriesOptions = data
    ? [
        ...new Map(
          data.groups.paid.filter((b) => b.seriesId).map((b) => [b.seriesId!, b.title]),
        ).entries(),
      ]
    : [];
  const paidRows = (data?.groups.paid ?? []).filter((b) => !series || b.seriesId === series);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-display font-semibold tracking-tight text-ink">Bills</h1>
        <p className="mt-1 text-ink-muted">
          What is due, when, and what was paid. "Due soon" means within {DUE_SOON_DAYS} days; a
          reminder rule has its own lead time.
        </p>
      </div>

      <BillForm
        busy={busy}
        onSubmit={async (fields) => {
          setBusy(true);
          try {
            await createBill(repo, fields, clock);
          } finally {
            setBusy(false);
          }
        }}
      />

      {error ? (
        <p role="alert" className="text-sm text-danger">
          Bills could not be loaded: {error.message}
        </p>
      ) : loading && !data ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : data ? (
        <>
          <Group
            title="Overdue"
            tone="danger"
            bills={data.groups.overdue}
            totals={formatTotals(data.totals.overdue)}
            view={data}
            empty="Nothing overdue."
          />
          <Group
            title="Due soon"
            tone="gold"
            bills={data.groups.dueSoon}
            totals={formatTotals(data.totals.dueSoon)}
            view={data}
            empty={`Nothing due in the next ${DUE_SOON_DAYS} days.`}
          />
          <Group
            title="Upcoming"
            tone="neutral"
            bills={data.groups.upcoming}
            totals={formatTotals(data.totals.upcoming)}
            view={data}
            empty="No later bills."
          />
          <section aria-label="Paid history">
            <SectionHeader
              title="Paid history"
              meta={`${data.groups.paid.length}`}
              actions={
                <>
                  {showPaid && seriesOptions.length ? (
                    <Select
                      aria-label="Filter paid history by series"
                      value={series}
                      onChange={(e) => setSeries(e.target.value)}
                      className="h-8 w-44"
                    >
                      <option value="">All bills</option>
                      {seriesOptions.map(([id, title]) => (
                        <option key={id} value={id}>
                          {title}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setShowPaid((v) => !v)}>
                    {showPaid ? 'Hide' : 'Show'}
                  </Button>
                </>
              }
            />
            {showPaid ? (
              paidRows.length ? (
                <ul className="flex flex-col gap-1" aria-label="Paid bills">
                  {paidRows.map((b) => (
                    <Row key={b.id} bill={b} view={data} tone="ok" />
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-faint">No payments recorded yet.</p>
              )
            ) : null}
          </section>
          {data.groups.deleted.length ? (
            <section aria-label="Deleted bills">
              <SectionHeader
                title="Deleted"
                meta={`${data.groups.deleted.length}`}
                actions={
                  <Button size="sm" variant="ghost" onClick={() => setShowDeleted((v) => !v)}>
                    {showDeleted ? 'Hide' : 'Show'}
                  </Button>
                }
              />
              {showDeleted ? (
                <ul className="flex flex-col gap-1" aria-label="Deleted bills list">
                  {data.groups.deleted.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center gap-3 rounded-md border border-dashed border-line px-3 py-2 text-sm text-ink-muted"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {b.title} · {b.amount} {b.currency} · {b.dueAt}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void restoreBill(repo, b.id, clock).catch((e: unknown) =>
                            toast({
                              title: 'Could not restore',
                              description: e instanceof Error ? e.message : String(e),
                              variant: 'danger',
                            }),
                          )
                        }
                      >
                        Restore
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Group({
  title,
  tone,
  bills,
  totals,
  view,
  empty,
}: {
  title: string;
  tone: 'danger' | 'gold' | 'neutral';
  bills: Bill[];
  totals: string;
  view: BillsView;
  empty: string;
}) {
  return (
    <section aria-label={title} data-testid={`bills-${title.toLowerCase().replace(' ', '-')}`}>
      <SectionHeader title={title} meta={totals || undefined} />
      {bills.length === 0 ? (
        <EmptyState icon={<Receipt />} title={empty} className="py-4" />
      ) : (
        <ul className="flex flex-col gap-1" aria-label={`${title} bills`}>
          {bills.map((b) => (
            <Row key={b.id} bill={b} view={view} tone={tone} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({
  bill,
  view,
  tone,
}: {
  bill: Bill;
  view: BillsView;
  tone: 'danger' | 'gold' | 'neutral' | 'ok';
}) {
  const reminder = view.reminders.get(bill.id);
  return (
    <li>
      <Link
        to={routeFor({ type: 'bill', id: bill.id })!}
        className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-2/40 px-3 py-2 hover:bg-surface-2"
        data-testid="bill-row"
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{bill.title}</span>
        <span className="text-sm text-ink tnum">
          {bill.amount}{' '}
          {bill.currency || <span className="text-ink-faint">(currency not set)</span>}
        </span>
        <Badge tone={tone === 'ok' ? 'ok' : tone === 'neutral' ? 'outline' : tone}>
          {bill.paid
            ? `paid ${bill.paidAt ? toLocalDate(new Date(bill.paidAt)) : '(time not recorded)'}`
            : `due ${bill.dueAt}`}
        </Badge>
        {bill.recurrence ? (
          <Badge tone="outline" title={describeRecurrence(bill.recurrence, bill.recurrenceAnchor)}>
            {bill.repeatStopped
              ? 'repeat stopped'
              : describeRecurrence(bill.recurrence, bill.recurrenceAnchor)}
          </Badge>
        ) : null}
        {!bill.paid ? (
          <span className="text-[12px] text-ink-faint" data-testid="bill-reminder">
            {reminder ? `reminder ${toLocalDate(new Date(reminder.fireAt))}` : 'no reminder rule'}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
