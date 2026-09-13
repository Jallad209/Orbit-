import { minuteOfDay, toLocalDate } from '@orbit/core';
import type { LocalDate, TimeWindow } from '@orbit/core';
import { Moon, Sunrise } from 'lucide-react';
import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/Button';

/** When no working window is set, the evening starts at 17:00 (configurable in week 9). */
export const EVENING_FALLBACK_MIN = 17 * 60;

/** The minute of day the "Evening shutdown" launcher appears from. */
export function eveningStartMin(workingWindow: TimeWindow | null | undefined): number {
  return workingWindow?.endMin ?? EVENING_FALLBACK_MIN;
}

interface Props {
  /** The day the Today screen is planning. */
  date: LocalDate;
  now: Date;
  /** Whether `date` already has an accepted commitment. */
  hasCommitment: boolean;
  workingWindow: TimeWindow | null | undefined;
}

/**
 * Entry points to the two daily reviews: the morning briefing while the day
 * has no commitment yet, the evening shutdown once the working window ends.
 */
export function ReviewLaunchers({ date, now, hasCommitment, workingWindow }: Props) {
  const today = toLocalDate(now);
  const evening = minuteOfDay(now) >= eveningStartMin(workingWindow);
  const showMorning = !hasCommitment;
  if (!showMorning && !evening) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid="review-launchers">
      {showMorning ? (
        <Link
          to={`/review/morning?date=${date}`}
          className={buttonVariants({ variant: 'gold', size: 'md' })}
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
    </div>
  );
}
