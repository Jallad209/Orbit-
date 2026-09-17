import { describeRecurrence, formatMinute, systemClock, toLocalDate } from '@orbit/core';
import type { Clock } from '@orbit/core';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { LinkedPanel } from '@/components/LinkedPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, SectionHeader } from '@/components/ui/Card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/Dialog';
import { FieldError, Input, Label } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { useDraftRegistration } from '@/features/drafts/DraftGuard';
import { useRepository } from '@/platform';
import { routeFor } from '@/lib/destinations';
import { BillForm } from './BillForm';
import {
  advanceLegacy,
  billFieldErrors,
  createBill,
  deleteBill,
  deletionNote,
  editBill,
  loadBill,
  payBill,
  restoreBill,
  stopRepeating,
  unpayBill,
  type BillDetail,
} from './billsService';

function report(title: string, e: unknown): void {
  toast({ title, description: e instanceof Error ? e.message : String(e), variant: 'danger' });
}

function localInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * One bill occurrence: its money fields and deadline (editable while
 * unpaid), its place in the schedule, Mark paid with the generated
 * successor shown, Stop repeating, a confirmed delete that explains what
 * stops, and read-only paid history with the one-off correction. A
 * recurring row is always this occurrence, never "the latest one".
 */
export function BillPage({ clock = systemClock }: { clock?: Clock }) {
  const { id } = useParams();
  const repo = useRepository();
  const { data, loading, error } = useRepoQuery(
    (r) => (id ? loadBill(r, id) : Promise.resolve(null)),
    [id],
  );
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        This bill could not be loaded: {error.message}
      </p>
    );
  }
  if (!data) {
    if (loading) return <p className="text-sm text-ink-muted">Loading…</p>;
    return (
      <EmptyState
        title="That bill no longer exists"
        description="The link may be old, or the bill was removed."
        action={
          <Link to="/bills" className="text-sm underline">
            Back to bills
          </Link>
        }
      />
    );
  }
  if (data.bill.deletedAt !== null) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Link to="/bills" className="text-[13px] text-ink-muted hover:underline">
          ← Bills
        </Link>
        <EmptyState
          title={`${data.bill.title} was deleted`}
          description="Its history and links are kept. Restoring does not generate anything; reminders follow the usual rules."
          action={
            <Button
              variant="secondary"
              onClick={() =>
                void restoreBill(repo, data.bill.id, clock).catch((e) =>
                  report('Could not restore', e),
                )
              }
            >
              Restore bill
            </Button>
          }
        />
      </div>
    );
  }
  return <Detail key={`${data.bill.id}:${data.bill.updatedAt}`} detail={data} clock={clock} />;
}

function Detail({ detail, clock }: { detail: BillDetail; clock: Clock }) {
  const { bill } = detail;
  const repo = useRepository();
  const navigate = useNavigate();
  const [title, setTitle] = useState(bill.title);
  const [amount, setAmount] = useState(String(bill.amount));
  const [currency, setCurrency] = useState(bill.currency);
  const [dueAt, setDueAt] = useState(bill.dueAt ?? '');
  const [dueTime, setDueTime] = useState(bill.dueTime === null ? '' : formatMinute(bill.dueTime));
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'failed'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [paidAt, setPaidAt] = useState(() => localInput(clock.now().toISOString()));
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [newSeries, setNewSeries] = useState(false);

  const dirty =
    !bill.paid &&
    (title !== bill.title ||
      Number(amount) !== bill.amount ||
      currency !== bill.currency ||
      dueAt !== (bill.dueAt ?? '') ||
      dueTime !== (bill.dueTime === null ? '' : formatMinute(bill.dueTime)));
  const errors = billFieldErrors({
    title,
    amount: amount.trim() === '' ? NaN : Number(amount),
    currency,
    dueAt: dueAt || null,
    recurrence: null,
  });

  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (errors) {
      setSaveError(Object.values(errors)[0]!);
      return false;
    }
    setSaveState('saving');
    setSaveError(null);
    try {
      await editBill(
        repo,
        bill,
        {
          title,
          amount: Number(amount),
          currency,
          dueAt: dueAt || null,
          dueTime: dueTime ? Number(dueTime.slice(0, 2)) * 60 + Number(dueTime.slice(3, 5)) : null,
        },
        clock,
      );
      setSaveState('idle');
      return true;
    } catch (e) {
      setSaveState('failed');
      setSaveError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  useDraftRegistration({
    key: `bill:${bill.id}`,
    label: `Bill “${bill.title}”`,
    dirty,
    status:
      errors && dirty ? 'invalid' : saveState === 'failed' ? 'failed' : dirty ? 'editing' : 'saved',
    error: errors && dirty ? Object.values(errors)[0]! : saveError,
    flush: async () =>
      (await save()) ? { ok: true } : { ok: false, reason: saveError ?? 'Not saved.' },
    discard: () => {
      setTitle(bill.title);
      setAmount(String(bill.amount));
      setCurrency(bill.currency);
      setDueAt(bill.dueAt ?? '');
      setDueTime(bill.dueTime === null ? '' : formatMinute(bill.dueTime));
      setSaveError(null);
    },
  });

  const pay = async () => {
    const instant = new Date(paidAt);
    if (!Number.isFinite(instant.getTime())) {
      report('Could not mark paid', new Error('Enter a real date and time.'));
      return;
    }
    if (dirty && !(await save())) return;
    setPaying(true);
    try {
      const outcome = await payBill(repo, bill, instant.toISOString(), { clock });
      toast({
        title: outcome.replayed ? 'Already paid' : 'Marked paid',
        description: outcome.successor
          ? `Next occurrence: ${outcome.successor.dueAt}.`
          : outcome.plan.kind === 'finished'
            ? 'Series finished: no further occurrence.'
            : outcome.plan.kind === 'stopped'
              ? 'Repeat is stopped: no further occurrence.'
              : 'No further occurrence.',
        variant: 'success',
        action: outcome.successor
          ? {
              label: 'Open next',
              onClick: () => void navigate(routeFor({ type: 'bill', id: outcome.successor!.id })!),
            }
          : undefined,
      });
    } catch (e) {
      report('Could not mark paid', e);
    } finally {
      setPaying(false);
    }
  };

  const schedule = bill.recurrence
    ? describeRecurrence(bill.recurrence, bill.recurrenceAnchor)
    : 'One-off';

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link to="/bills" className="text-[13px] text-ink-muted hover:underline">
          ← Bills
        </Link>
        <h1 className="mt-1 text-display font-semibold tracking-tight text-ink">{bill.title}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-ink-muted">
          {bill.paid ? (
            <Badge tone="ok" data-testid="bill-status">
              Paid{' '}
              {bill.paidAt
                ? localInput(bill.paidAt).replace('T', ' ')
                : '(payment time not recorded)'}
            </Badge>
          ) : (
            <Badge
              tone={
                bill.dueAt !== null && bill.dueAt < toLocalDate(clock.now()) ? 'danger' : 'outline'
              }
              data-testid="bill-status"
            >
              {bill.dueAt
                ? `Due ${bill.dueAt}${bill.dueTime === null ? '' : ` at ${formatMinute(bill.dueTime)}`}`
                : 'No due date'}
            </Badge>
          )}
          <Badge tone="outline" data-testid="bill-schedule">
            {schedule}
          </Badge>
          {bill.seriesId ? (
            <span className="text-[13px]" data-testid="bill-position">
              Occurrence {bill.occurrenceIndex + 1}
              {bill.scheduledFor && bill.scheduledFor !== bill.dueAt
                ? ` · scheduled for ${bill.scheduledFor}, deadline moved to ${bill.dueAt}`
                : bill.scheduledFor
                  ? ` · scheduled for ${bill.scheduledFor}`
                  : ''}
            </span>
          ) : null}
          {bill.repeatStopped ? <Badge tone="gold">Repeat stopped</Badge> : null}
          {detail.reminder ? (
            <span className="text-[13px]" data-testid="bill-reminder">
              Reminder on {toLocalDate(new Date(detail.reminder.fireAt))}
            </span>
          ) : null}
        </p>
      </div>

      {bill.paid ? (
        <Card className="flex flex-col gap-3">
          <p className="text-sm text-ink">
            This payment is history: {bill.amount} {bill.currency || '(currency not set)'} for{' '}
            {bill.dueAt}. It stays as it was paid.
          </p>
          {detail.successor ? (
            <p className="text-[13px] text-ink-muted">
              It generated the next occurrence,{' '}
              <Link to={routeFor({ type: 'bill', id: detail.successor.id })!} className="underline">
                due {detail.successor.dueAt}
              </Link>
              . Reversing a payment that generated a successor is not offered here; edit the next
              occurrence instead.
            </p>
          ) : detail.legacyPaid ? (
            <div className="flex flex-col gap-2" data-testid="legacy-advance">
              <p className="text-[13px] text-ink-muted">
                This was paid before Orbit linked successors, so nothing was generated. Assuming the
                schedule "{schedule}" anchored on {bill.recurrenceAnchor}, the next occurrence would
                be <strong>{detail.plan.kind === 'next' ? detail.plan.date : '—'}</strong>. Nothing
                happens unless you ask.
              </p>
              <div>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void advanceLegacy(repo, bill, clock)
                      .then((o) =>
                        toast({
                          title: o.replayed ? 'Already created' : 'Next occurrence created',
                          description: o.successor
                            ? `Due ${o.successor.dueAt}.`
                            : 'No occurrence to create.',
                          variant: 'success',
                        }),
                      )
                      .catch((e) => report('Could not create the next occurrence', e))
                  }
                >
                  Create next occurrence
                </Button>
              </div>
            </div>
          ) : bill.seriesId === null ? (
            <div>
              <Button
                variant="secondary"
                onClick={() =>
                  void unpayBill(repo, bill, clock).catch((e) =>
                    report('Could not return to unpaid', e),
                  )
                }
              >
                Return to unpaid
              </Button>
              <p className="mt-1 text-[12px] text-ink-faint">
                A one-off correction: clears the payment time and queues its reminder again.
              </p>
            </div>
          ) : null}
        </Card>
      ) : (
        <Card className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="edit-amount">Amount</Label>
              <Input
                id="edit-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="edit-currency">Currency</Label>
              <Input
                id="edit-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="edit-due" hint={bill.seriesId ? undefined : 'optional'}>
                Deadline for this occurrence
              </Label>
              <Input
                id="edit-due"
                type="date"
                value={dueAt}
                onChange={(e) => {
                  setDueAt(e.target.value);
                  if (!e.target.value) setDueTime('');
                }}
                className="mt-1"
              />
              {bill.seriesId ? (
                <p className="mt-1 text-[12px] text-ink-faint">
                  Moves only this deadline; the schedule stays on {bill.scheduledFor}.
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="edit-due-time" hint="optional">
                Due time
              </Label>
              <Input
                id="edit-due-time"
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                disabled={!dueAt}
                className="mt-1"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={() => void save()}
              disabled={!dirty || saveState === 'saving'}
              loading={saveState === 'saving'}
            >
              Save changes
            </Button>
            <span className="text-[12px] text-ink-faint" data-testid="bill-save-state">
              {saveState === 'saving' ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}
            </span>
            <FieldError>
              {saveError ?? (dirty && errors ? Object.values(errors)[0] : undefined)}
            </FieldError>
          </div>
        </Card>
      )}

      {!bill.paid ? (
        <Card className="flex flex-wrap items-end gap-3" data-testid="pay-card">
          <div>
            <Label htmlFor="paid-at">Paid on</Label>
            <Input
              id="paid-at"
              type="datetime-local"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              className="mt-1"
            />
          </div>
          <Button variant="primary" onClick={() => void pay()} loading={paying} disabled={paying}>
            Mark paid
          </Button>
          <p className="basis-full text-[12px] text-ink-faint">
            {detail.plan.kind === 'next'
              ? `Marking paid creates the next occurrence, due ${detail.plan.date}.`
              : detail.plan.kind === 'finished'
                ? 'This is the last occurrence of the series; nothing follows.'
                : detail.plan.kind === 'stopped'
                  ? 'Repeat is stopped; nothing follows.'
                  : detail.plan.kind === 'invalid'
                    ? `The schedule cannot continue: ${detail.plan.message}`
                    : 'Nothing else is created.'}
          </p>
        </Card>
      ) : null}

      {bill.seriesId ? (
        <section aria-label="Series">
          <SectionHeader title="This series" meta={schedule} />
          <ul className="flex flex-col gap-1" aria-label="Occurrences">
            {detail.series.map((b) => (
              <li key={b.id} className="flex items-center gap-2 text-sm">
                <span className="w-24 text-ink-faint">#{b.occurrenceIndex + 1}</span>
                {b.id === bill.id ? (
                  <span className="font-medium">{b.dueAt} (this one)</span>
                ) : (
                  <Link to={routeFor({ type: 'bill', id: b.id })!} className="underline">
                    {b.dueAt}
                  </Link>
                )}
                <Badge tone={b.deletedAt ? 'outline' : b.paid ? 'ok' : 'neutral'}>
                  {b.deletedAt ? 'deleted' : b.paid ? 'paid' : 'unpaid'}
                </Badge>
              </li>
            ))}
          </ul>
          {!bill.paid && detail.latestUnpaid && !bill.repeatStopped ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  void stopRepeating(repo, bill, { clock })
                    .then(() =>
                      toast({
                        title: 'Repeat stopped',
                        description: 'This occurrence stays; nothing follows it.',
                        variant: 'success',
                      }),
                    )
                    .catch((e) => report('Could not stop the series', e))
                }
              >
                Stop repeating
              </Button>
              <Button variant="ghost" onClick={() => setNewSeries((v) => !v)}>
                {newSeries ? 'Cancel new series' : 'Change the schedule…'}
              </Button>
            </div>
          ) : null}
          {newSeries ? (
            <Card className="mt-3 flex flex-col gap-2" data-testid="new-series">
              <p className="text-[13px] text-ink-muted">
                A series that has begun keeps its history. To change the pattern, stop this one and
                start a new recurring bill from a future date; check the preview for overlap with
                the occurrence due {bill.dueAt}.
              </p>
              <BillForm
                submitLabel="Stop this series and start the new one"
                initial={{ title: bill.title, amount: bill.amount, currency: bill.currency }}
                onSubmit={async (fields) => {
                  await stopRepeating(repo, bill, { clock });
                  const created = await createBill(repo, fields, clock);
                  setNewSeries(false);
                  void navigate(routeFor({ type: 'bill', id: created.id })!);
                }}
              />
            </Card>
          ) : null}
        </section>
      ) : null}

      <LinkedPanel entity={{ type: 'bill', id: bill.id }} clock={clock} />

      <div>
        <Button
          variant="ghost"
          onClick={() =>
            void deletionNote(repo, bill).then(setConfirmDelete, (e) =>
              report('Could not check', e),
            )
          }
        >
          <Trash2 className="size-4" aria-hidden="true" /> Delete this bill
        </Button>
      </div>
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(o) => (!o ? setConfirmDelete(null) : null)}
      >
        <DialogContent size="sm">
          <DialogTitle>Delete {bill.title}?</DialogTitle>
          <DialogDescription>{confirmDelete}</DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmDelete(null);
                void deleteBill(repo, bill.id, clock).catch((e) => report('Could not delete', e));
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
