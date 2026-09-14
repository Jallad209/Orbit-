import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from '@/components/ui/toastStore';
import { useAppStore } from '@/app/store';
import { recordEvent } from '@/lib/diagnostics';
import { usePlatform } from '@/platform';
import { CloseExplanationDialog } from './CloseExplanationDialog';

/** The week-10 localStorage flag, read raw once for the native migration. */
export const LEGACY_CLOSE_KEY = 'orbit-close-to-tray';

function readLegacyClose(): string | null {
  try {
    return localStorage.getItem(LEGACY_CLOSE_KEY);
  } catch {
    return null;
  }
}

/**
 * The main window's side of the resident shell (desktop only). Transfers
 * the legacy close preference once, so a user close is honoured against the
 * user's own setting rather than a temporary default; routes tray
 * navigation; shows the first-close explanation; and reports shutdown
 * problems instead of letting the window vanish mid-write.
 */
export function ResidentBridge() {
  const platform = usePlatform();
  const navigate = useNavigate();
  const desktop = platform.desktop;
  const [explaining, setExplaining] = useState(false);
  const setQuitting = useAppStore((s) => s.setQuitting);
  const reconciles = useAppStore((s) => s.reminderReconciles);
  const acked = useRef(false);

  // Readiness: the data file is open and migrated (providers mounted), the legacy preference
  // is transferred, and the reminder queue has been reconciled once. Only this window (the
  // shell's main window, the only one that mounts the app shell) says so, once per mount.
  useEffect(() => {
    if (!desktop || acked.current || reconciles === 0) return;
    acked.current = true;
    void desktop.prefs
      .migrateLegacy(readLegacyClose())
      .catch(() => undefined)
      .then(() => desktop.markReady())
      .catch((e: unknown) => {
        acked.current = false;
        recordEvent('warn', 'resident:ready-rejected', { attempt: reconciles });
        void e;
      });
  }, [desktop, reconciles]);

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    const offs: Array<() => void> = [];
    const subscribe = async () => {
      // The legacy flag first: close-to-tray decisions wait for it.
      await desktop.prefs.migrateLegacy(readLegacyClose()).catch(() => undefined);
      const handlers: Array<[Parameters<typeof desktop.onShellEvent>[0], (p: unknown) => void]> = [
        ['orbit:navigate', (path) => typeof path === 'string' && void navigate(path)],
        ['orbit:close-explain', () => setExplaining(true)],
        [
          'orbit:close-blocked',
          () =>
            toast({
              title: 'Orbit is still starting',
              description: 'Close it again in a moment, once your preferences have loaded.',
              variant: 'warning',
            }),
        ],
        [
          'orbit:quit-failed',
          (message) =>
            toast({
              title: 'Orbit did not quit',
              description: typeof message === 'string' ? message : 'Try again in a moment.',
              variant: 'danger',
              durationMs: 0,
            }),
        ],
        [
          'orbit:ready-timeout',
          () =>
            toast({
              title: 'Orbit did not finish starting in the background',
              description:
                'Check the data folder in Settings → Data; reminders wait until it opens.',
              variant: 'warning',
              durationMs: 0,
            }),
        ],
        ['orbit:quitting', () => setQuitting(true)],
      ];
      for (const [name, handler] of handlers) {
        const off = await desktop.onShellEvent(name, handler).catch(() => () => {});
        if (cancelled) off();
        else offs.push(off);
      }
    };
    void subscribe();
    return () => {
      cancelled = true;
      for (const off of offs) off();
    };
  }, [desktop, navigate, setQuitting]);

  if (!desktop) return null;
  return (
    <CloseExplanationDialog
      open={explaining}
      onHide={() => {
        setExplaining(false);
        void desktop.prefs
          .set({ closeExplanationSeen: true })
          .then(() => desktop.hideMain())
          .catch(() => undefined);
      }}
      onQuit={() => {
        setExplaining(false);
        void desktop.prefs.set({ closeExplanationSeen: true }).catch(() => undefined);
        void desktop.quit();
      }}
      onCancel={() => setExplaining(false)}
    />
  );
}
