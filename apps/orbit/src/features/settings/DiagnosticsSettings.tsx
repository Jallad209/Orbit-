import { systemClock } from '@orbit/core';
import type { Clock } from '@orbit/core';
import { Bug, CheckCircle2, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { useAppStore } from '@/app/store';
import { useRepoQuery } from '@/data/useQuery';
import { useSearchService } from '@/features/search/searchService';
import { usePlatform, useRepository } from '@/platform';
import type { LastRun } from '@/platform/types';
import {
  buildDiagnosticsReport,
  saveDiagnostics,
  type SavedDiagnostics,
} from './diagnosticsService';

export const BUG_REPORTS_URL = 'https://github.com/Jallad209/Orbit-/blob/main/docs/BUG-REPORTS.md';

/**
 * Settings → Data → Diagnostics: one button that writes a local bundle
 * (a zip with rolling logs on desktop, a JSON file on the web), a plain
 * statement of what it holds and what it never holds, and the previous
 * run's fate. Nothing here talks to a network.
 */
export function DiagnosticsSettings({ clock = systemClock }: { clock?: Clock } = {}) {
  const platform = usePlatform();
  const repo = useRepository();
  const search = useSearchService();
  const storage = useAppStore((s) => s.storageStatus);
  const { data: lastRun } = useRepoQuery<LastRun | null>(
    async () => (platform.desktop ? platform.desktop.lastRun() : null),
    [platform],
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const report = await buildDiagnosticsReport({
        platform,
        repo,
        search,
        storage,
        lastRun: lastRun ?? null,
        clock,
      });
      const result = await saveDiagnostics(platform, report, clock);
      setSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="diagnostics-settings">
      <SectionHeader title="Diagnostics" />
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-ink-muted">
          Orbit keeps no telemetry. When something goes wrong, you can save a bundle yourself and
          attach it to a bug report after looking inside.
        </p>
        <ul className="grid gap-1.5 text-[13px] sm:grid-cols-2">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden="true" />
            <span>
              <strong className="font-medium">Inside:</strong> versions, the runtime, record counts,
              the integrity result, the search backend, the previous run’s outcome, error kinds and
              positions{platform.desktop ? ', and the rolling log files' : ''}.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <ShieldOff className="mt-0.5 size-4 shrink-0 text-gold-ink" aria-hidden="true" />
            <span>
              <strong className="font-medium">Never:</strong> titles, note bodies, names, contacts,
              search queries, SQL parameters, or any record.
            </span>
          </li>
        </ul>
        {lastRun ? (
          <p className="text-[13px]" data-testid="last-run">
            {lastRun.crashedLastTime ? (
              <span className="text-gold-ink">
                Orbit did not close cleanly last time
                {lastRun.crash ? ` (${lastRun.crash.location})` : ''}. If it happens again, save a
                bundle right after restarting.
              </span>
            ) : (
              <span className="text-ink-muted">Orbit closed cleanly last time.</span>
            )}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" loading={busy} onClick={save}>
            <Bug className="size-3.5" aria-hidden="true" /> Save diagnostics bundle
          </Button>
          <a
            href={BUG_REPORTS_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] text-ink-muted underline hover:text-ink"
          >
            How to report a bug
          </a>
        </div>
        {saved ? (
          <p className="text-[13px] text-ink-muted" role="status" data-testid="diagnostics-saved">
            Saved <code className="font-mono">{saved.location}</code>
            {saved.files.length > 1 ? ` (${saved.files.length} files)` : ''}. Open it and read it
            before sharing.
          </p>
        ) : null}
        {error ? (
          <p className="text-[13px] text-danger" role="alert">
            Could not save the bundle: {error}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
