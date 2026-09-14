import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router';
import { Skeleton } from '@/components/ui/Card';
import type { PreviewRef } from '@/features/search/searchActions';
import { useInsights } from './useInsights';

/** The card and its evidence renderer live with the Insights page; the strip loads them on demand. */
const InsightCard = lazy(() => import('./InsightCard').then((m) => ({ default: m.InsightCard })));
const SearchPreview = lazy(() =>
  import('@/features/search/SearchPreview').then((m) => ({ default: m.SearchPreview })),
);

export const STRIP_LIMIT = 3;

/**
 * Today's insights strip: the first three unsuppressed observations from
 * the shared engine, in the same order as the Insights page, with a link
 * to all of them. Snooze and dismiss stay on that page; a reload or another
 * window's snooze produces the same three because the view is shared.
 */
export function InsightsStrip() {
  const { view, error, stale } = useInsights();
  const [preview, setPreview] = useState<PreviewRef | null>(null);
  if (!view && !error) return null;
  const items = view?.active.slice(0, STRIP_LIMIT) ?? [];
  const rest = (view?.active.length ?? 0) - items.length;
  if (!items.length && !error) return null;
  return (
    <section aria-label="Insights" data-testid="insights" className="flex flex-col gap-1.5">
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {stale
            ? 'Insights could not be refreshed; these are from before.'
            : 'Insights could not be computed.'}{' '}
          <Link to="/insights" className="underline">
            Open insights
          </Link>
        </p>
      ) : null}
      <Suspense fallback={<Skeleton className="h-12" />}>
        {items.map((insight) => (
          <InsightCard
            key={insight.key}
            insight={insight}
            compact
            onPreview={(d) => setPreview(d.ref)}
          />
        ))}
        {preview ? <SearchPreview target={preview} onClose={() => setPreview(null)} /> : null}
      </Suspense>
      {items.length ? (
        <p className="text-[12px] text-ink-faint">
          <Link to="/insights" className="underline" data-testid="insights-see-all">
            See all{rest > 0 ? ` (${rest} more)` : ''}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
