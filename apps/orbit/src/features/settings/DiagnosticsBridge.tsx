import { useEffect } from 'react';
import { toast } from '@/components/ui/toastStore';
import { subscribeEvents } from '@/lib/diagnostics';
import { usePlatform } from '@/platform';

const NOTICE_KEY = 'orbit-crash-notice-shown-for';

/**
 * Desktop wiring for diagnostics: every event the web side records is
 * forwarded (already redacted) to the shell's rolling log, and a previous
 * run that did not close cleanly gets one gentle notice.
 */
export function DiagnosticsBridge() {
  const platform = usePlatform();
  const desktop = platform.desktop;

  useEffect(() => {
    if (!desktop) return;
    return subscribeEvents((event) => {
      const fields: Record<string, number | boolean> = { ...event.fields };
      if (event.line) fields.line = event.line;
      if (event.col) fields.col = event.col;
      void desktop
        .logEvent(event.level, `${event.source}:${event.kind}`, fields)
        .catch(() => undefined);
    });
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    void desktop
      .lastRun()
      .then((run) => {
        if (cancelled || !run.crashedLastTime || !run.startedAt) return;
        try {
          // One notice per crashed run, not one per window or reload.
          if (localStorage.getItem(NOTICE_KEY) === run.startedAt) return;
          localStorage.setItem(NOTICE_KEY, run.startedAt);
        } catch {
          /* preference only */
        }
        toast({
          title: 'Orbit did not close cleanly last time',
          description:
            'Your data was checked at startup. If it happens again, Settings → Data → Save diagnostics bundle captures what went wrong.',
          variant: 'warning',
          durationMs: 12_000,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  return null;
}
