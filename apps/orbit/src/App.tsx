import { BrowserRouter } from 'react-router';
import { HotkeyProvider } from '@/lib/HotkeyProvider';
import { PlatformProvider } from '@/platform';
import { AppRoutes } from '@/routes';
import { Toaster } from '@/components/ui/Toast';
import { TooltipProvider } from '@/components/ui/Popover';
import { useReminderScheduler } from '@/features/reminders/useReminderScheduler';
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

export function App() {
  return (
    <PlatformProvider fallback={opening}>
      <SettingsProvider fallback={opening}>
        <TooltipProvider delayDuration={400}>
          <BrowserRouter>
            <HotkeyProvider>
              <AppRoutes />
            </HotkeyProvider>
          </BrowserRouter>
          <Toaster />
          <PwaBridge />
          <ReminderBridge />
        </TooltipProvider>
      </SettingsProvider>
    </PlatformProvider>
  );
}
