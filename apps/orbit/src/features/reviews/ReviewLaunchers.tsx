import { minuteOfDay, toLocalDate } from '@orbit/core';
import type { LocalDate } from '@orbit/core';
import { ListChecks, Moon, Sunrise } from 'lucide-react';
import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/Button';

/** Used until the settings document has a value (Settings → Planning sets it). */
export const EVENING_FALLBACK_MIN = 17 * 60;

interface Props {
  /** The day the Today screen is planning. */
  date: LocalDate;
  now: Date;
  /** Whether `date` already has an accepted commitment. */
  hasCommitment: boolean;
  /** Minute of day the evening launcher appears from (Settings → Planning). */
  eveningStartMin?: number | null;
  /** The weekly review launcher (week 12): start, resume an unfinished one, or none. */
  weekly?: 'start' | 'resume' | null;
}

/**
 * Entry points to the two daily reviews: the morning briefing while the day
 * has no commitment yet, the evening shutdown once the working window ends.
 */
export function ReviewLaunchers({
  date,
  now,
  hasCommitment,
  eveningStartMin,
  weekly = null,
}: Props) {
  const today = toLocalDate(now);
  const evening = minuteOfDay(now) >= (eveningStartMin ?? EVENING_FALLBACK_MIN);
  const showMorning = !hasCommitment;
  if (!showMorning && !evening && !weekly) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid="review-launchers">
      {showMorning ? (
        <Link
          to={`/review/morning?date=${date}`}
          className={buttonVariants({ variant: 'secondary', size: 'md' })}
          data-testid="launch-morning"
        >
          <Sunrise className="size-4" aria-hidden="true" />
          Start morning briefing
        </Link>
      ) : null}
      {evening ? (
        <Link
          to={`/review/evening?date=${today}`}
          className={buttonVariants({ variant: 'secondary', size: 'md' })}
          data-testid="launch-evening"
        >
          <Moon className="size-4" aria-hidden="true" />
          Evening shutdown
        </Link>
      ) : null}
      {weekly ? (
        <Link
          to="/review/weekly"
          className={buttonVariants({ variant: 'secondary', size: 'md' })}
          data-testid="launch-weekly"
        >
          <ListChecks className="size-4" aria-hidden="true" />
          {weekly === 'resume' ? 'Resume weekly review' : 'Weekly review'}
        </Link>
      ) : null}
    </div>
  );
}
