import { BrowserRouter } from 'react-router';
import { HotkeyProvider } from '@/lib/HotkeyProvider';
import { PlatformProvider } from '@/platform';
import { AppRoutes } from '@/routes';
import { Toaster } from '@/components/ui/Toast';
import { TooltipProvider } from '@/components/ui/Popover';
import { usePwa } from '@/pwa/usePwa';

function PwaBridge() {
  usePwa();
  return null;
}

export function App() {
  return (
    <PlatformProvider
      fallback={
        <div className="grid h-dvh place-items-center bg-surface text-ink-muted">
          Opening Orbit…
        </div>
      }
    >
      <TooltipProvider delayDuration={400}>
        <BrowserRouter>
          <HotkeyProvider>
            <AppRoutes />
          </HotkeyProvider>
        </BrowserRouter>
        <Toaster />
        <PwaBridge />
      </TooltipProvider>
    </PlatformProvider>
  );
}
