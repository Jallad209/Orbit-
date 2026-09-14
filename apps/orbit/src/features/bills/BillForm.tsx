import { describeRecurrence, previewSchedule, validateBillFields } from '@orbit/core';
import type { Recurrence, Weekday } from '@orbit/core';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { FieldError, Input, Label, Select } from '@/components/ui/Input';
import type { BillFields } from './billsService';

const WEEKDAYS: Array<{ value: Weekday; label: string }> = [
  { value: 'MO', label: 'Mon' },
  { value: 'TU', label: 'Tue' },
  { value: 'WE', label: 'Wed' },
  { value: 'TH', label: 'Thu' },
  { value: 'FR', label: 'Fri' },
  { value: 'SA', label: 'Sat' },
  { value: 'SU', label: 'Sun' },
];

type Freq = 'none' | Recurrence['freq'];

interface Props {
  onSubmit: (fields: BillFields) => Promise<void>;
  busy?: boolean;
  /** Preset for "create a new series after stopping this one". */
  initial?: Partial<BillFields>;
  submitLabel?: string;
}

/**
 * New bill: money fields, first due date, and an optional schedule that is
 * previewed (first occurrence and the next two) and validated before
 * anything is saved — the first date must agree with the rule.
 */
export function BillForm({
  onSubmit,
  busy = false,
  initial = {},
  submitLabel = 'Add bill',
}: Props) {
  const [title, setTitle] = useState(initial.title ?? '');
  const [amount, setAmount] = useState(initial.amount !== undefined ? String(initial.amount) : '');
  const [currency, setCurrency] = useState(initial.currency ?? '');
  const [dueAt, setDueAt] = useState(initial.dueAt ?? '');
  const [freq, setFreq] = useState<Freq>(initial.recurrence?.freq ?? 'none');
  const [interval, setInterval] = useState(String(initial.recurrence?.interval ?? 1));
  const [byDay, setByDay] = useState<Weekday[]>(initial.recurrence?.byDay ?? []);
  const [byMonthDay, setByMonthDay] = useState(
    initial.recurrence?.byMonthDay ? String(initial.recurrence.byMonthDay) : '',
  );
  const [end, setEnd] = useState<'never' | 'count' | 'until'>(
    initial.recurrence?.count ? 'count' : initial.recurrence?.until ? 'until' : 'never',
  );
  const [count, setCount] = useState(String(initial.recurrence?.count ?? ''));
  const [until, setUntil] = useState(initial.recurrence?.until ?? '');
  const [submitted, setSubmitted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const recurrence: Recurrence | null =
    freq === 'none'
      ? null
      : {
          freq,
          interval: Number(interval) || 0,
          byDay: freq === 'weekly' ? byDay : [],
          byMonthDay: freq === 'monthly' && byMonthDay ? Number(byMonthDay) : null,
          count: end === 'count' && count ? Number(count) : null,
          until: end === 'until' && until ? until : null,
        };
  const fields: BillFields = {
    title,
    amount: amount.trim() === '' ? NaN : Number(amount),
    currency,
    dueAt,
    recurrence,
  };
  const errors = validateBillFields(fields);
  const valid = Object.keys(errors).length === 0;
  const preview = recurrence && valid ? previewSchedule(recurrence, dueAt) : [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!valid) return;
    setProblem(null);
    try {
      await onSubmit({ ...fields, title: title.trim(), currency: currency.trim() });
      setTitle('');
      setAmount('');
      setDueAt('');
      setSubmitted(false);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    }
  };

  const show = (key: keyof typeof errors) => (submitted ? errors[key] : undefined);

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label="New bill" noValidate>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <Label htmlFor="bill-title">Title</Label>
          <Input
            id="bill-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Rent"
            invalid={!!show('title')}
            className="mt-1"
          />
          <FieldError>{show('title')}</FieldError>
        </div>
        <div>
          <Label htmlFor="bill-amount">Amount</Label>
          <Input
            id="bill-amount"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            invalid={!!show('amount')}
            className="mt-1"
          />
          <FieldError>{show('amount')}</FieldError>
        </div>
        <div>
          <Label htmlFor="bill-currency" hint="optional">
            Currency
          </Label>
          <Input
            id="bill-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            placeholder="USD"
            maxLength={8}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="bill-due">{recurrence ? 'First due date' : 'Due date'}</Label>
          <Input
            id="bill-due"
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            invalid={!!show('dueAt')}
            className="mt-1"
          />
          <FieldError>{show('dueAt')}</FieldError>
        </div>
        <div>
          <Label htmlFor="bill-repeat">Repeats</Label>
          <Select
            id="bill-repeat"
            value={freq}
            onChange={(e) => setFreq(e.target.value as Freq)}
            className="mt-1"
          >
            <option value="none">Never</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </div>
        {recurrence ? (
          <>
            <div>
              <Label htmlFor="bill-interval">Every</Label>
              <Input
                id="bill-interval"
                type="number"
                min={1}
                max={1000}
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                className="mt-1"
                aria-describedby="bill-interval-unit"
              />
              <span id="bill-interval-unit" className="text-[12px] text-ink-faint">
                {freq === 'daily' ? 'day(s)' : freq === 'weekly' ? 'week(s)' : 'month(s)'}
              </span>
            </div>
            {freq === 'weekly' ? (
              <fieldset className="md:col-span-2">
                <legend className="text-[13px] font-medium text-ink">On</legend>
                <div className="mt-1 flex flex-wrap gap-1">
                  {WEEKDAYS.map((d) => {
                    const on = byDay.includes(d.value);
                    return (
                      <button
                        key={d.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setByDay((prev) =>
                            on ? prev.filter((w) => w !== d.value) : [...prev, d.value],
                          )
                        }
                        className={`h-7 rounded-full px-2.5 text-[12px] font-medium ${on ? 'bg-nav text-nav-fg' : 'bg-surface-2 text-ink-muted hover:bg-surface-3'}`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[12px] text-ink-faint">
                  Leave empty to repeat on the first date's weekday.
                </p>
              </fieldset>
            ) : null}
            {freq === 'monthly' ? (
              <div>
                <Label htmlFor="bill-monthday" hint="optional">
                  Day of month
                </Label>
                <Input
                  id="bill-monthday"
                  type="number"
                  min={1}
                  max={31}
                  value={byMonthDay}
                  onChange={(e) => setByMonthDay(e.target.value)}
                  placeholder="from the first date"
                  className="mt-1"
                />
              </div>
            ) : null}
            <div>
              <Label htmlFor="bill-end">Ends</Label>
              <Select
                id="bill-end"
                value={end}
                onChange={(e) => setEnd(e.target.value as typeof end)}
                className="mt-1"
              >
                <option value="never">Never</option>
                <option value="count">After a number of times</option>
                <option value="until">On a date</option>
              </Select>
            </div>
            {end === 'count' ? (
              <div>
                <Label htmlFor="bill-count">Times</Label>
                <Input
                  id="bill-count"
                  type="number"
                  min={1}
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  className="mt-1"
                />
              </div>
            ) : null}
            {end === 'until' ? (
              <div>
                <Label htmlFor="bill-until">Last date (inclusive)</Label>
                <Input
                  id="bill-until"
                  type="date"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  className="mt-1"
                />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {recurrence ? (
        <p className="text-[13px] text-ink-muted" data-testid="bill-preview">
          {show('recurrence') ? (
            <span className="text-danger">{errors.recurrence}</span>
          ) : preview.length ? (
            <>
              {describeRecurrence(recurrence, dueAt)}: first on {preview[0]}
              {preview.length > 1 ? `, then ${preview.slice(1).join(' and ')}` : ''}
              {preview.length < 3 ? ' (the series ends there)' : ''}
            </>
          ) : errors.recurrence ? (
            <span className="text-danger">{errors.recurrence}</span>
          ) : (
            'Choose the first date to preview the schedule.'
          )}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-[13px] text-danger">
          {problem}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" disabled={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
