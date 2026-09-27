import { useLayoutEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { StorageBanner } from '@/components/StorageBanner';
import { ExportReminder } from '@/components/ExportReminder';
import { QuickCaptureOverlay } from '@/features/inbox/QuickCaptureOverlay';
import { ResidentBridge } from '@/features/desktop/ResidentBridge';
import { InsightsProvider } from '@/features/insights/InsightsProvider';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { NavRail } from './NavRail';

/**
 * Application frame: charcoal navigation rail on the left, warm workspace on
 * the right. The rail collapses to icons under the `md` breakpoint.
 *
 * The document scrolls and the rail is sticky, one window tall, with its own
 * scrollbar for short windows. Keeping the document as the scroller keeps the
 * browser's own keyboard scrolling: with an inner scrolling pane, Page Down
 * pressed after clicking a rail link had nothing to scroll.
 */
export function AppLayout() {
  const { pathname } = useLocation();
  // The document outlives every route, so its scroll position would carry over to the next
  // page. A layout effect resets it before pages' own effects scroll to a linked item.
  useLayoutEffect(() => {
    (document.scrollingElement ?? document.documentElement).scrollTop = 0;
  }, [pathname]);

  // Insights are computed once for every screen in the shell; the capture window has no shell.
  return (
    <InsightsProvider>
      <div
        data-testid="app-shell"
        className="grid min-h-dvh grid-cols-[3.5rem_1fr] bg-surface md:grid-cols-[14rem_1fr]"
      >
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-lime focus:px-3 focus:py-1.5 focus:text-lime-ink"
        >
          Skip to content
        </a>
        <NavRail />
        <div className="flex min-w-0 flex-col">
          <StorageBanner />
          <ExportReminder />
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-6 py-8 md:px-10">
            <Outlet />
          </main>
        </div>
        <QuickCaptureOverlay />
        <CommandPalette />
        <ResidentBridge />
      </div>
    </InsightsProvider>
  );
}
