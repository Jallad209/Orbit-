import { Link, useSearchParams } from 'react-router';
import { buttonVariants } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Card';
import { isDestinationType, type DestinationType } from '@/lib/destinations';

const NOUN: Record<DestinationType, string> = {
  person: 'person',
  commitment: 'commitment',
  bill: 'bill',
  note: 'note',
  task: 'task',
  project: 'project',
  goal: 'goal',
  review: 'weekly review',
  reminder: 'reminder',
  timelineBlock: 'timeline block',
  area: 'area',
  capture: 'capture',
};

const LIST: Partial<Record<DestinationType, string>> = {
  person: '/people',
  commitment: '/people',
  bill: '/bills',
  note: '/notes',
  task: '/projects',
  project: '/projects',
  goal: '/goals',
  review: '/review/weekly',
  reminder: '/settings#rules',
  timelineBlock: '/timeline',
  area: '/areas',
  capture: '/inbox',
};

/**
 * The safe landing for a link whose record is gone: a reminder for a
 * deleted bill, a search result that was removed elsewhere, an old URL.
 * It explains and offers the list; it never opens a different record.
 */
export function MissingRecordPage() {
  const [params] = useSearchParams();
  const raw = params.get('type') ?? '';
  const type: DestinationType | null = isDestinationType(raw) ? raw : null;
  const noun = type ? NOUN[type] : 'record';
  const list = type ? LIST[type] : undefined;
  return (
    <EmptyState
      title={`That ${noun} no longer exists`}
      description="It was deleted, or the link came from data that is no longer here. Nothing was changed by opening this link."
      action={
        list ? (
          <Link to={list} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Open the list
          </Link>
        ) : (
          <Link to="/today" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Go to Today
          </Link>
        )
      }
    />
  );
}
