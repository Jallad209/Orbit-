import { systemClock, toLocalDate } from '@orbit/core';
import type { Clock } from '@orbit/core';
import { WalletCards } from 'lucide-react';
import { useCallback, useState, type FormEvent } from 'react';
import type { Repository } from '@orbit/storage';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, SectionHeader, Skeleton } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { useRepository } from '@/platform';
import { createSpendingItem, loadSpending, type SpendingSummary } from './spendingService';

function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency || '(currency not set)'}`;
}

function totals(summary: SpendingSummary): string {
  return summary.totals.map((item) => money(item.total, item.currency)).join(' · ');
}

function monthLabel(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
    new Date(year, number - 1, 1, 12),
  );
}

function Breakdown({ summary, label }: { summary: SpendingSummary; label: string }) {
  return (
    <Card className="flex flex-col gap-2">
      <SectionHeader title={label} meta={totals(summary)} />
      {summary.groups.length ? (
        <ul className="flex flex-col gap-1 text-sm" aria-label={`${label} spending breakdown`}>
          {summary.groups.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">
                {item.label}
                <span className="ml-1 text-[12px] text-ink-faint">
                  {item.count} item{item.count === 1 ? '' : 's'}
                </span>
              </span>
              <strong className="shrink-0 font-medium tnum">
                {money(item.total, item.currency)}
              </strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-faint">Nothing logged.</p>
      )}
    </Card>
  );
}

export function SpendingPanel({ clock = systemClock }: { clock?: Clock }) {
  const repo = useRepository();
  const query = useCallback((r: Repository) => loadSpending(r, clock), [clock]);
  const { data, loading, refresh } = useRepoQuery(query, [query]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('JOD');
  const [spentOn, setSpentOn] = useState(() => toLocalDate(clock.now()));
  const [busy, setBusy] = useState(false);
  const parsedAmount = Number(amount);
  const valid =
    name.trim().length > 0 &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    currency.trim().length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await createSpendingItem(repo, { name, amount: parsedAmount, currency, spentOn }, clock);
      toast({
        title: 'Spending added',
        description: `${name.trim()} · ${money(parsedAmount, currency.trim().toUpperCase())}`,
        variant: 'success',
      });
      setName('');
      setAmount('');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Spending log" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-h1 font-semibold tracking-tight text-ink">Spending log</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            Name each purchase however you like. Matching names are combined in weekly and monthly
            summaries.
          </p>
        </div>
        <Button variant={open ? 'ghost' : 'primary'} onClick={() => setOpen((value) => !value)}>
          {open ? 'Done adding' : 'Add spending'}
        </Button>
      </div>

      {open ? (
        <Card className="border-lime/40 bg-lime/5">
          <form
            className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_9rem_7rem_11rem_auto]"
            onSubmit={submit}
          >
            <div>
              <Label htmlFor="spending-name">Item</Label>
              <Input
                id="spending-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Food, transport, coffee…"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="spending-amount">Amount</Label>
              <Input
                id="spending-amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label htmlFor="spending-currency">Currency</Label>
              <Input
                id="spending-currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                placeholder="JOD"
                maxLength={8}
              />
            </div>
            <div>
              <Label htmlFor="spending-date">Date</Label>
              <Input
                id="spending-date"
                type="date"
                value={spentOn}
                onChange={(event) => setSpentOn(event.target.value)}
              />
            </div>
            <Button type="submit" variant="primary" disabled={!valid} loading={busy}>
              Add item
            </Button>
          </form>
          <p className="mt-2 text-[12px] text-ink-faint">
            The form stays open so you can enter several purchases quickly. All calculations stay on
            this device.
          </p>
        </Card>
      ) : null}

      {loading && !data ? (
        <Skeleton className="h-36" />
      ) : data ? (
        <>
          {data.isFirstDayOfMonth ? (
            <Card className="border-gold/50 bg-gold/10" data-testid="first-day-summary">
              <p className="text-[12px] font-semibold tracking-wide text-gold-ink uppercase">
                Last month’s spending
              </p>
              <p className="mt-1 text-h1 font-semibold tnum">{totals(data.previousMonth)}</p>
              <p className="mt-1 text-[13px] text-ink-muted">
                {data.previousMonth.groups.length
                  ? data.previousMonth.groups
                      .map((item) => `${item.label} ${money(item.total, item.currency)}`)
                      .join(' · ')
                  : 'No spending was logged last month.'}
              </p>
            </Card>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2" data-testid="spending-summaries">
            <Breakdown summary={data.week} label="This week" />
            <Breakdown summary={data.month} label={monthLabel(data.month.month!)} />
          </div>
          <section aria-label="Recent spending">
            <SectionHeader title="Recent items" meta={`${data.recent.length}`} />
            {data.recent.length ? (
              <ul className="flex flex-col gap-1" aria-label="Spending items">
                {data.recent.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 rounded-md border border-line bg-surface-2/40 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                    <span className="text-[12px] text-ink-faint tnum">{item.dueAt}</span>
                    <strong className="font-medium tnum">
                      {money(item.amount, item.currency)}
                    </strong>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<WalletCards />}
                title="No spending logged"
                description="Add your first purchase; weekly and monthly totals build automatically."
                className="py-6"
              />
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
