import { systemClock } from '@orbit/core';
import type { Clock } from '@orbit/core';
import { useEffect, useRef } from 'react';
import { toast } from '@/components/ui/toastStore';
import { useAppStore } from '@/app/store';
import { bumpData } from '@/data/useQuery';
import { usePlatform, useRepository } from '@/platform';
import {
  claimReminder,
  loadDueReminders,
  markReminder,
  reconcileReminderQueue,
} from './reminderService';

/** How often the queue is reconciled and, on the web, fired. */
export const REMINDER_POLL_MS = 60_000;

/**
 * The in-app reminder scheduler. On every runtime it keeps the queue filled
 * from the reminder rules (once a minute and after any write). Where the
 * shell has no native scheduler it also fires due reminders as toasts —
 * the honest web behaviour: reminders only while the tab is open. Desktop
 * leaves firing to `scheduler.rs`, which raises OS notifications.
 */
export function useReminderScheduler(clock: Clock = systemClock): void {
  const repo = useRepository();
  const platform = usePlatform();
  const version = useAppStore((s) => s.dataVersion);
  const running = useRef(false);
  const native = platform.capabilities.nativeReminders;

  useEffect(() => {
    const tick = async () => {
      if (running.current) return; // a slow tick never overlaps the next
      running.current = true;
      try {
        await reconcileReminderQueue(repo, clock);
        if (native) return;
        const due = await loadDueReminders(repo, clock);
        for (const pending of due) {
          // Mark first so a crash mid-toast cannot fire it twice; one bump at the end.
          const r = await claimReminder(repo, pending, clock);
          if (!r) continue;
          void platform.notify(r.title, r.body);
          toast({
            id: `reminder-${r.id}`,
            title: r.title,
            description: r.body || undefined,
            variant: 'warning',
            durationMs: 0,
            action: { label: 'Dismiss', onClick: () => void markReminder(repo, r, 'dismissed') },
          });
        }
        if (due.length) bumpData();
      } catch {
        /* next tick retries; nothing to surface for a background poll */
      } finally {
        running.current = false;
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), REMINDER_POLL_MS);
    return () => clearInterval(interval);
    // `version` re-runs the reconcile after any write (a new bill, a new rule).
  }, [repo, platform, clock, native, version]);
}
