import { RouterProvider, createBrowserRouter } from 'react-router';
import { DraftGuard } from '@/features/drafts/DraftGuard';
import { HotkeyProvider } from '@/lib/HotkeyProvider';
import { PlatformProvider } from '@/platform';
import { AppRoutes } from '@/routes';
import { Toaster } from '@/components/ui/Toast';
import { TooltipProvider } from '@/components/ui/Popover';
import { CommandRegistryProvider } from '@/features/palette/commandRegistry';
import { useReminderScheduler } from '@/features/reminders/useReminderScheduler';
import { SearchProvider } from '@/features/search/SearchProvider';
import { DiagnosticsBridge } from '@/features/settings/DiagnosticsBridge';
import { SettingsProvider } from '@/features/settings/SettingsProvider';
import { usePwa } from '@/pwa/usePwa';

function PwaBridge() {
  usePwa();
  return null;
}

function ReminderBridge() {
  useReminderScheduler();
  return null;
}

const opening = (
  <div className="grid h-dvh place-items-center bg-surface text-ink-muted">Opening Orbit…</div>
);

/**
 * The route tree stays the descendant `<Routes>` in `routes.tsx`; a data
 * router hosts it (week 12) so the draft guard can block navigation with
 * `useBlocker`. Created once: the providers above it keep their lifetimes
 * across every navigation, and the lazy chunks load as before.
 */
function RootShell() {
  return (
    <HotkeyProvider>
      <AppRoutes />
      <DraftGuard />
    </HotkeyProvider>
  );
}

const router = createBrowserRouter([{ path: '*', element: <RootShell /> }]);

export function App() {
  return (
    <PlatformProvider fallback={opening}>
      <SettingsProvider fallback={opening}>
        <SearchProvider>
          <CommandRegistryProvider>
            <TooltipProvider delayDuration={400}>
              <RouterProvider router={router} />
              <Toaster />
              <PwaBridge />
              <ReminderBridge />
              <DiagnosticsBridge />
            </TooltipProvider>
          </CommandRegistryProvider>
        </SearchProvider>
      </SettingsProvider>
    </PlatformProvider>
  );
}
