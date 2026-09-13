import type { SearchHit } from '@orbit/storage';
import { CalendarPlus, Check, ExternalLink, Eye, Link2 } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { TypeBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Card';
import { Highlighted } from '@/features/palette/PaletteResults';
import { cn } from '@/lib/cn';

export type HitAction = 'open' | 'preview' | 'complete' | 'schedule' | 'link';

interface Props {
  hits: readonly SearchHit[];
  /** The free text of the query, for highlighting. */
  query: string;
  loading: boolean;
  error: string | null;
  /** Whether a query is present at all (else the page shows a prompt, not "no results"). */
  hasQuery: boolean;
  busyId: string | null;
  onAction: (hit: SearchHit, action: HitAction) => void;
}

/** The actions each type offers, in display order. Only existing behaviour. */
export function actionsFor(hit: SearchHit): HitAction[] {
  switch (hit.type) {
    case 'task':
      return ['preview', 'complete', 'schedule', 'link'];
    case 'project':
      return ['open'];
    case 'note':
    case 'person':
      return ['preview', 'link'];
  }
}

const ACTION_LABEL: Record<HitAction, string> = {
  open: 'Open',
  preview: 'Preview',
  complete: 'Complete',
  schedule: 'Schedule today',
  link: 'Link…',
};

const ACTION_ICON: Record<HitAction, typeof Eye> = {
  open: ExternalLink,
  preview: Eye,
  complete: Check,
  schedule: CalendarPlus,
  link: Link2,
};

/**
 * The full result list: type chip, highlighted title and snippet, and the
 * quick actions. Arrow keys move between rows; Enter on a row opens it.
 */
export function SearchResults({ hits, query, loading, error, hasQuery, busyId, onAction }: Props) {
  const listRef = useRef<HTMLUListElement>(null);

  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])];
    if (!rows.length) return;
    const current = rows.findIndex(
      (r) => r === document.activeElement || r.contains(document.activeElement),
    );
    const next =
      e.key === 'ArrowDown' ? Math.min(rows.length - 1, current + 1) : Math.max(0, current - 1);
    rows[next]?.focus();
    e.preventDefault();
  };

  if (error) {
    return (
      <p role="alert" className="text-sm text-danger" data-testid="search-error">
        Search failed: {error}
      </p>
    );
  }
  if (!hasQuery) {
    return (
      <p className="text-sm text-ink-muted" data-testid="search-prompt">
        Type to search tasks, notes, projects, and people. Narrow with{' '}
        <code className="font-mono">type:note</code> or <code className="font-mono">area:name</code>
        .
      </p>
    );
  }
  if (loading && !hits.length) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" data-testid="search-loading">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-3/4" />
      </div>
    );
  }
  if (!hits.length) {
    return (
      <p className="text-sm text-ink-muted" data-testid="search-empty">
        No results for “{query}”. Try fewer or different words.
      </p>
    );
  }

  return (
    <ul
      ref={listRef}
      aria-label="Search results"
      aria-busy={loading || undefined}
      className={cn('flex flex-col gap-1.5', loading && 'opacity-70')}
      onKeyDown={onKey}
    >
      {hits.map((hit) => {
        const actions = actionsFor(hit);
        const primary = actions[0]!;
        const busy = busyId === hit.id;
        return (
          <li
            key={`${hit.type}:${hit.id}`}
            data-testid="search-hit"
            data-type={hit.type}
            className="flex items-start gap-3 rounded-md border border-line bg-surface-2/50 px-3 py-2.5"
          >
            <TypeBadge kind={hit.type} className="mt-0.5 shrink-0" />
            <button
              type="button"
              data-row
              className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-lime-2"
              aria-label={`${ACTION_LABEL[primary]} ${hit.title}`}
              onClick={() => onAction(hit, primary)}
            >
              <span className="block truncate font-medium text-ink">
                <Highlighted text={hit.title} query={query} />
              </span>
              {hit.snippet ? (
                <span className="block truncate text-[13px] text-ink-muted">
                  <Highlighted text={hit.snippet} query={query} />
                </span>
              ) : null}
            </button>
            <div className="flex shrink-0 items-center gap-0.5">
              {actions.map((action) => {
                const Icon = ACTION_ICON[action];
                return (
                  <Button
                    key={action}
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${ACTION_LABEL[action]}: ${hit.title}`}
                    title={ACTION_LABEL[action]}
                    disabled={busy}
                    onClick={() => onAction(hit, action)}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </Button>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
