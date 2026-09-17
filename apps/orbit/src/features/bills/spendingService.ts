import {
  BillSchema,
  addDays,
  createRecord,
  startOfWeek,
  systemClock,
  toInstant,
  toLocalDate,
} from '@orbit/core';
import type { Bill, Clock, LocalDate } from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { mutate } from '@/data/mutations';
import { createDirectReminder } from '@/features/reminders/reminderService';

export interface SpendingGroup {
  key: string;
  label: string;
  count: number;
  total: number;
}

export interface SpendingSummary {
  month?: string;
  start: LocalDate;
  endExclusive: LocalDate;
  total: number;
  groups: SpendingGroup[];
  entries: Bill[];
}

export interface SpendingView {
  today: LocalDate;
  isFirstDayOfMonth: boolean;
  week: SpendingSummary;
  month: SpendingSummary;
  previousMonth: SpendingSummary;
  recent: Bill[];
}

export function normalizeSpendingName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function monthStart(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`;
}

function shiftMonth(date: LocalDate, delta: number): LocalDate {
  const [year, month] = date.split('-').map(Number) as [number, number];
  return toLocalDate(new Date(year, month - 1 + delta, 1));
}

function titleCase(value: string): string {
  return value.replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

export function summarizeSpending(
  rows: readonly Bill[],
  start: LocalDate,
  endExclusive: LocalDate,
): SpendingSummary {
  const entries = rows
    .filter(
      (item) =>
        item.kind === 'expense' &&
        item.deletedAt === null &&
        item.dueAt !== null &&
        item.dueAt >= start &&
        item.dueAt < endExclusive,
    )
    .sort(
      (a, b) =>
        (b.dueAt ?? '').localeCompare(a.dueAt ?? '') ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
  const grouped = new Map<string, SpendingGroup>();
  for (const item of entries) {
    const key = normalizeSpendingName(item.title);
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      existing.total += item.amount;
    } else {
      grouped.set(key, { key, label: titleCase(key), count: 1, total: item.amount });
    }
  }
  return {
    start,
    endExclusive,
    total: entries.reduce((sum, item) => sum + item.amount, 0),
    groups: [...grouped.values()].sort(
      (a, b) => b.total - a.total || a.label.localeCompare(b.label),
    ),
    entries,
  };
}

export async function loadSpending(
  repo: Repository,
  clock: Clock = systemClock,
): Promise<SpendingView> {
  const today = toLocalDate(clock.now());
  const rows = await repo.bills.query((bill) => bill.kind === 'expense');
  const weekStart = startOfWeek(today);
  const currentMonth = monthStart(today);
  const previousMonth = shiftMonth(currentMonth, -1);
  const nextMonth = shiftMonth(currentMonth, 1);
  return {
    today,
    isFirstDayOfMonth: today.endsWith('-01'),
    week: summarizeSpending(rows, weekStart, addDays(weekStart, 7)),
    month: { ...summarizeSpending(rows, currentMonth, nextMonth), month: currentMonth.slice(0, 7) },
    previousMonth: {
      ...summarizeSpending(rows, previousMonth, currentMonth),
      month: previousMonth.slice(0, 7),
    },
    recent: [...rows]
      .filter((item) => item.deletedAt === null)
      .sort(
        (a, b) =>
          (b.dueAt ?? '').localeCompare(a.dueAt ?? '') || b.createdAt.localeCompare(a.createdAt),
      )
      .slice(0, 30),
  };
}

function reminderBody(summary: SpendingSummary): string {
  if (!summary.groups.length) return 'No spending was logged.';
  const items = summary.groups
    .slice(0, 6)
    .map((item) => `${item.label} ${item.total.toFixed(2)} JOD`)
    .join(' · ');
  const more = summary.groups.length > 6 ? ` · +${summary.groups.length - 6} more` : '';
  return `${summary.total.toFixed(2)} JOD total · ${items}${more}`;
}

export async function createSpendingItem(
  repo: Repository,
  input: { name: string; amount: number; spentOn: LocalDate },
  clock: Clock = systemClock,
): Promise<Bill> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Name the item.');
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    throw new Error('Enter an amount greater than zero.');
  const item = createRecord(BillSchema, clock, {
    kind: 'expense',
    title: name,
    amount: Math.round(input.amount * 100) / 100,
    currency: 'JOD',
    dueAt: input.spentOn,
    dueTime: null,
    recurrence: null,
    paid: true,
    paidAt: clock.now().toISOString(),
  });
  const saved = await mutate(repo, (tx) => tx.bills.upsert(item));

  const month = monthStart(input.spentOn);
  const nextMonth = shiftMonth(month, 1);
  const fireAt = toInstant(nextMonth, 9 * 60);
  if (fireAt.getTime() > clock.now().getTime()) {
    const all = await repo.bills.query((bill) => bill.kind === 'expense');
    const summary = summarizeSpending(all, month, nextMonth);
    await createDirectReminder(
      repo,
      {
        key: `monthly-spending:${month.slice(0, 7)}`,
        source: 'monthly-spending',
        entityType: 'bill',
        entityId: saved.id,
        fireAt: fireAt.toISOString(),
        title: `${month.slice(0, 7)} spending summary`,
        body: reminderBody(summary),
        destination: `/bills?month=${month.slice(0, 7)}`,
      },
      clock,
    );
  }
  return saved;
}
