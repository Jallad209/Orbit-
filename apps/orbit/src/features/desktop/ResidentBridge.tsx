import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from '@/components/ui/toastStore';
import { useAppStore } from '@/app/store';
import { confirmLeave, flushDrafts } from '@/features/drafts/draftStore';
import { isFirstRunDone } from '@/features/firstRun/firstRun';
import { recordEvent } from '@/lib/diagnostics';
import { parseOrbitUri, resolveDestination } from '@/lib/destinations';
import { usePlatform, useRepository } from '@/platform';
import type { QuitCancelled, QuitPrepareRequest } from '@/platform/types';
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
 * problems instead of letting the window vanish mid-write. Before a quit
 * (week 12) it saves every registered draft and acknowledges with the
 * request and generation ids, or refuses with the reason; the shell then
 * cancels and the failure stays visible with a "discard and quit" choice.
 * An activation (`orbit://` from a notification click or the protocol
 * handler) is parsed again here, resolved against current data through
 * the typed resolver, and navigated to — through the draft guard, so a
 * dirty editor asks first. It never mutates anything; a missing record
 * lands on the safe missing page.
 */
export function ResidentBridge() {
  const platform = usePlatform();
  const repo = useRepository();
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
    let activationSubscription: number | null = null;
    const offs: Array<() => void> = [];
    const subscribe = async () => {
      // The legacy flag first: close-to-tray decisions wait for it.
      await desktop.prefs.migrateLegacy(readLegacyClose()).catch(() => undefined);
      const handlers: Array<[Parameters<typeof desktop.onShellEvent>[0], (p: unknown) => void]> = [
        ['orbit:navigate', (path) => typeof path === 'string' && void navigate(path)],
        [
          'orbit:activate',
          (payload) => {
            const destination = typeof payload === 'string' ? parseOrbitUri(payload) : null;
            if (!destination) {
              recordEvent('warn', 'activation:rejected');
              return;
            }
            recordEvent('info', 'activation:open');
            void resolveDestination(repo, destination)
              .then(async (resolved) => {
                // First-run onboarding owns the screen until "Start planning": hold the
                // destination and let the welcome page finish there.
                if (!isFirstRunDone()) {
                  useAppStore.getState().setPendingActivation(resolved.path);
                  return;
                }
                // An activation is an imperative exit from whatever is open (a shell event,
                // not an in-app link), so `useBlocker` does not see it; ask through the same
                // draft guard before leaving, exactly as the PWA reload does. Only when the
                // page actually changes — reopening the record already on screen never prompts.
                const target = new URL(resolved.path, window.location.origin).pathname;
                if (target !== window.location.pathname && !(await confirmLeave('open the record')))
                  return;
                void navigate(resolved.path);
              })
              .catch(() => navigate('/today'));
          },
        ],
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
        [
          'orbit:quit-prepare',
          (payload) => {
            const request = payload as QuitPrepareRequest;
            void flushDrafts()
              .then((result) =>
                desktop.ackQuit(request, result.ok, result.ok ? undefined : result.reason),
              )
              .catch((e: unknown) =>
                desktop.ackQuit(request, false, e instanceof Error ? e.message : 'Save failed.'),
              )
              .catch(() => undefined);
          },
        ],
        [
          'orbit:quit-cancelled',
          (payload) => {
            const cancelled = payload as QuitCancelled;
            toast({
              id: 'quit-cancelled',
              title: 'Orbit did not quit',
              description: cancelled.reason,
              variant: 'warning',
              durationMs: 0,
              action: {
                label: 'Discard unsaved changes and quit',
                onClick: () => void desktop.quit({ force: true }),
              },
            });
          },
        ],
      ];
      for (const [name, handler] of handlers) {
        const off = await desktop.onShellEvent(name, handler).catch(() => () => {});
        if (cancelled) off();
        else offs.push(off);
      }
      // The `orbit:activate` listener is attached now: tell the shell it may deliver a
      // held activation (a cold notification click races frontend readiness, so the
      // shell waits for this rather than emitting into a window that is not yet listening).
      if (!cancelled) {
        const generation = await desktop.activationSubscribed().catch(() => undefined);
        if (generation !== undefined) {
          if (cancelled) {
            void desktop.activationUnsubscribed(generation).catch(() => undefined);
          } else {
            activationSubscription = generation;
          }
        }
      }
    };
    void subscribe();
    return () => {
      cancelled = true;
      for (const off of offs) off();
      // Native delivery must pause while this renderer has no listener. Otherwise a
      // reload can leave the shell's one-time subscription flag stale and lose a click.
      if (activationSubscription !== null) {
        void desktop.activationUnsubscribed(activationSubscription).catch(() => undefined);
      }
    };
  }, [desktop, repo, navigate, setQuitting]);

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
