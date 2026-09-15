import { formatMinute, parseMinute } from '@orbit/core';
import { importJson, parseExport, ExportError } from '@orbit/storage';
import { Check, FolderOpen, Import, Sun } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { bumpData } from '@/data/useQuery';
import { saveSettings } from '@/features/settings/settingsService';
import { usePlanPrefs } from '@/features/today/planSettings';
import { usePlatform, useRepository } from '@/platform';
import { useAppStore } from '@/app/store';
import { markFirstRunDone } from './firstRun';

/**
 * Desktop welcome: where the data lives, an optional import of the browser
 * export, and the working window. Three short steps, then Today.
 */
export function FirstRunPage() {
  const platform = usePlatform();
  const repo = useRepository();
  const navigate = useNavigate();
  const prefs = usePlanPrefs();
  const desktop = platform.desktop;
  const status = desktop?.dataFileStatus() ?? null;

  const [start, setStart] = useState(formatMinute(prefs.workingWindow.startMin));
  const [end, setEnd] = useState(formatMinute(prefs.workingWindow.endMin));
  const [imported, setImported] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const windowError = (() => {
    try {
      const s = parseMinute(start);
      const e = parseMinute(end);
      return e > s ? null : 'The day has to end after it starts.';
    } catch {
      return 'Use HH:MM, for example 09:00.';
    }
  })();

  const chooseFolder = async () => {
    if (!desktop) return;
    setBusy(true);
    try {
      const dir = await desktop.pickDataFolder();
      if (dir) await desktop.relocateData(dir);
    } catch (e) {
      toast({
        title: 'Could not change data folder',
        description: e instanceof Error ? e.message : String(e),
        variant: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  const importExport = async () => {
    if (!desktop) return;
    const text = await desktop.pickExportFile();
    if (!text) return;
    setBusy(true);
    try {
      const report = await importJson(repo, parseExport(text), { mode: 'merge' });
      bumpData();
      const summary = `${report.totals.create} added, ${report.totals.update} updated`;
      setImported(summary);
      toast({ title: 'Import finished', description: summary, variant: 'success' });
    } catch (e) {
      toast({
        title: 'Import failed',
        description:
          e instanceof ExportError ? e.message : e instanceof Error ? e.message : String(e),
        variant: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (windowError) return;
    const workingWindow = { startMin: parseMinute(start), endMin: parseMinute(end) };
    prefs.setWorkingWindow(workingWindow);
    try {
      await saveSettings(repo, { workingWindow });
    } catch (e) {
      toast({
        title: 'Could not save the working window',
        description: e instanceof Error ? e.message : String(e),
        variant: 'danger',
      });
    }
    markFirstRunDone();
    // An activation that arrived during onboarding (a notification click on a fresh install)
    // is honoured now rather than lost.
    const pending = useAppStore.getState().pendingActivation;
    useAppStore.getState().setPendingActivation(null);
    navigate(pending ?? '/today', { replace: true });
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6" data-testid="first-run">
      <div>
        <h1 className="text-display font-semibold tracking-tight text-ink">Welcome to Orbit</h1>
        <p className="mt-1 text-ink-muted">
          Three quick choices. Everything can be changed later in Settings.
        </p>
      </div>

      <section
        className="rounded-lg border border-line bg-surface-2/60 p-4"
        aria-labelledby="step-data"
      >
        <h2
          id="step-data"
          className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-ink-muted uppercase"
        >
          <FolderOpen className="size-4" aria-hidden="true" /> 1 · Where your data lives
        </h2>
        <p className="mt-2 text-sm">
          Orbit keeps one file, <code className="font-mono text-[13px]">orbit.db</code>, in a folder
          you own. Put it in a synced folder if you want a copy elsewhere.
        </p>
        <p className="mt-2 truncate font-mono text-[13px] text-ink-muted" data-testid="data-dir">
          {status?.dir ?? 'Default app folder'}
        </p>
        <Button
          className="mt-3"
          variant="secondary"
          size="sm"
          onClick={chooseFolder}
          disabled={busy || !desktop}
        >
          Choose folder…
        </Button>
      </section>

      <section
        className="rounded-lg border border-line bg-surface-2/60 p-4"
        aria-labelledby="step-import"
      >
        <h2
          id="step-import"
          className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-ink-muted uppercase"
        >
          <Import className="size-4" aria-hidden="true" /> 2 · Bring your data from the browser
        </h2>
        <p className="mt-2 text-sm">
          Used Orbit in a browser? Export it there (Settings → Export) and import the file here.
          Nothing is lost: newer copies win.
        </p>
        {imported ? (
          <p
            className="mt-2 flex items-center gap-1 text-[13px] text-ok"
            data-testid="import-result"
          >
            <Check className="size-4" aria-hidden="true" /> {imported}
          </p>
        ) : null}
        <Button
          className="mt-3"
          variant="secondary"
          size="sm"
          onClick={importExport}
          disabled={busy || !desktop}
        >
          Import an Orbit export…
        </Button>
      </section>

      <section
        className="rounded-lg border border-line bg-surface-2/60 p-4"
        aria-labelledby="step-window"
      >
        <h2
          id="step-window"
          className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-ink-muted uppercase"
        >
          <Sun className="size-4" aria-hidden="true" /> 3 · Your working window
        </h2>
        <p className="mt-2 text-sm">The hours the planner may fill. Rest boundaries come later.</p>
        <div className="mt-3 flex items-center gap-3">
          <label className="text-[13px] text-ink-muted">
            From
            <Input
              aria-label="Working window start"
              className="mt-1 w-28"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="text-[13px] text-ink-muted">
            To
            <Input
              aria-label="Working window end"
              className="mt-1 w-28"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        {windowError ? <p className="mt-2 text-[13px] text-danger">{windowError}</p> : null}
      </section>

      <div className="flex justify-end">
        <Button variant="primary" onClick={() => void finish()} disabled={!!windowError || busy}>
          Start planning
        </Button>
      </div>
    </div>
  );
}
