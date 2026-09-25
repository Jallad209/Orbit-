import { useEffect } from 'react';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { DraftGuard } from '@/features/drafts/DraftGuard';
import { HotkeyProvider } from '@/lib/HotkeyProvider';
import { PlatformProvider, usePlatform } from '@/platform';
import { AppRoutes } from '@/routes';
import { Toaster } from '@/components/ui/Toast';
import { TooltipProvider } from '@/components/ui/Popover';
import { CommandRegistryProvider } from '@/features/palette/commandRegistry';
import { useReminderScheduler } from '@/features/reminders/useReminderScheduler';
import { SearchProvider } from '@/features/search/SearchProvider';
import { DiagnosticsBridge } from '@/features/settings/DiagnosticsBridge';
import { SettingsProvider } from '@/features/settings/SettingsProvider';
import { dropServiceWorker } from '@/pwa/dropServiceWorker';
import { usePwa } from '@/pwa/usePwa';

/**
 * The service worker exists to make the *web* app work offline. In the desktop shell the
 * assets are already local, so it buys nothing — and it costs: a worker that precached one
 * release keeps serving it after an upgrade, so the new shell talks to the old frontend and
 * the first database call fails. Registering it only on the web keeps that from starting;
 * `dropServiceWorker` clears up profiles that already have one (the shell also deletes the
 * worker's storage when the version changes, because a worker already serving a stale bundle
 * would never run this code).
 */
function PwaBridge() {
  usePwa();
  return null;
}

function WebOnlyPwa() {
  const platform = usePlatform();
  useEffect(() => {
    if (platform.name === 'web') return;
    void dropServiceWorker();
  }, [platform.name]);
  return platform.name === 'web' ? <PwaBridge /> : null;
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
      <ReminderBridge />
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
              <WebOnlyPwa />
              <DiagnosticsBridge />
            </TooltipProvider>
          </CommandRegistryProvider>
        </SearchProvider>
      </SettingsProvider>
    </PlatformProvider>
  );
}
