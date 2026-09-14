import { Outlet } from 'react-router';
import { StorageBanner } from '@/components/StorageBanner';
import { QuickCaptureOverlay } from '@/features/inbox/QuickCaptureOverlay';
import { InsightsProvider } from '@/features/insights/InsightsProvider';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { NavRail } from './NavRail';

/**
 * Application frame: charcoal navigation rail on the left, warm workspace on
 * the right. The rail collapses to icons under the `md` breakpoint.
 */
export function AppLayout() {
  // Insights are computed once for every screen in the shell; the capture window has no shell.
  return (
    <InsightsProvider>
      <div className="grid h-dvh grid-cols-[3.5rem_1fr] bg-surface md:grid-cols-[14rem_1fr]">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-lime focus:px-3 focus:py-1.5 focus:text-lime-ink"
        >
          Skip to content
        </a>
        <NavRail />
        <div className="flex min-w-0 flex-col">
          <StorageBanner />
          <main
            id="main"
            tabIndex={-1}
            className="min-w-0 flex-1 overflow-y-auto px-6 py-8 md:px-10"
          >
            <Outlet />
          </main>
        </div>
        <QuickCaptureOverlay />
        <CommandPalette />
      </div>
    </InsightsProvider>
  );
}
