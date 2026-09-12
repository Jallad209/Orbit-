import { BrowserRouter } from 'react-router';
import { HotkeyProvider } from '@/lib/HotkeyProvider';
import { PlatformProvider } from '@/platform';
import { AppRoutes } from '@/routes';

export function App() {
  return (
    <PlatformProvider
      fallback={
        <div className="grid h-dvh place-items-center bg-surface text-ink-muted">
          Opening Orbit…
        </div>
      }
    >
      <BrowserRouter>
        <HotkeyProvider>
          <AppRoutes />
        </HotkeyProvider>
      </BrowserRouter>
    </PlatformProvider>
  );
}
