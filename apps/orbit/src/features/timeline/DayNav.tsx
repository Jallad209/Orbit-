import type { LocalDate } from '@orbit/core';
import { addDays, fromLocalDate, startOfWeek } from '@orbit/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

interface Props {
  date: LocalDate;
  today: LocalDate;
  onChange: (date: LocalDate) => void;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Previous / next / today, plus a week strip. */
export function DayNav({ date, today, onChange }: Props) {
  const weekStart = startOfWeek(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="day-nav">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Previous day"
        onClick={() => onChange(addDays(date, -1))}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Next day"
        onClick={() => onChange(addDays(date, 1))}
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onChange(today)}
        disabled={date === today}
      >
        Today
      </Button>
      <div role="group" aria-label="Week" className="ml-1 flex rounded-md border border-line">
        {days.map((d, i) => (
          <button
            key={d}
            type="button"
            aria-pressed={d === date}
            aria-label={d}
            onClick={() => onChange(d)}
            className={cn(
              'flex h-9 w-11 flex-col items-center justify-center text-[11px] leading-tight',
              i === 0 && 'rounded-l-md',
              i === 6 && 'rounded-r-md',
              d === date ? 'bg-nav text-nav-fg' : 'text-ink-muted hover:bg-surface-2',
              d === today && d !== date && 'font-semibold text-lime-ink',
            )}
          >
            <span>{DAY_LABELS[i]}</span>
            <span className="tnum">{fromLocalDate(d).getDate()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
