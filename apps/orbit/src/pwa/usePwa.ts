import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useAppStore } from '@/app/store';
import { toast } from '@/components/ui/toastStore';
import { confirmLeave } from '@/features/drafts/draftStore';

/**
 * Registers the service worker and surfaces two moments as toasts:
 * "ready to work offline" on first install, and "update available" when a
 * newer bundle is waiting. Updates only apply when the user chooses.
 */
export function usePwa(): void {
  const setOfflineReady = useAppStore((s) => s.setOfflineReady);
  const setUpdateAvailable = useAppStore((s) => s.setUpdateAvailable);

  const {
    offlineReady: [offlineReady, setOfflineReadyFlag],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      // Not fatal: the app runs without a service worker, just not offline.
      // eslint-disable-next-line no-console -- surfaced for diagnostics; no logger yet (week 10)
      console.warn('Service worker registration failed', error);
    },
  });

  useEffect(() => {
    if (!offlineReady) return;
    setOfflineReady(true);
    toast({
      id: 'pwa-offline-ready',
      title: 'Orbit works offline now',
      description: 'You can close the network and keep planning.',
      variant: 'success',
    });
    setOfflineReadyFlag(false);
  }, [offlineReady, setOfflineReady, setOfflineReadyFlag]);

  useEffect(() => {
    if (!needRefresh) return;
    setUpdateAvailable(true);
    toast({
      id: 'pwa-update',
      title: 'A new version of Orbit is ready',
      description: 'Reload to use it. Your data is untouched.',
      durationMs: 0,
      action: {
        label: 'Reload',
        // A reload is a document unload: unsaved input goes through the same guard first.
        onClick: () => {
          void confirmLeave('reload Orbit').then((ok) => {
            if (ok) void updateServiceWorker(true);
          });
        },
      },
    });
    setNeedRefresh(false);
  }, [needRefresh, setUpdateAvailable, setNeedRefresh, updateServiceWorker]);
}
