import { ExportError, importJson, parseExport } from '@orbit/storage';
import type { ExportEnvelope, ImportMode, ImportReport } from '@orbit/storage';
import { Import } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { bumpData } from '@/data/useQuery';
import { usePlatform, useRepository } from '@/platform';
import { loadSettings } from './settingsService';

/**
 * Import an Orbit export in two steps: a dry run that shows what would
 * change, then Confirm. Merge keeps whichever copy is newer; Replace makes
 * the file the source of truth.
 */
export function ImportSettings() {
  const platform = usePlatform();
  const repo = useRepository();
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [pending, setPending] = useState<{ envelope: ExportEnvelope; report: ImportReport } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const preview = async (text: string) => {
    setBusy(true);
    try {
      const envelope = parseExport(text);
      const report = await importJson(repo, envelope, { mode, dryRun: true });
      setPending({ envelope, report });
    } catch (e) {
      toast({
        title: 'Cannot read that file',
        description:
          e instanceof ExportError ? e.message : e instanceof Error ? e.message : String(e),
        variant: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    if (platform.desktop) {
      const text = await platform.desktop.pickExportFile();
      if (text) await preview(text);
    } else {
      fileInput.current?.click();
    }
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const report = await importJson(repo, pending.envelope, { mode });
      await loadSettings(repo, undefined, { migrateLegacy: false });
      bumpData();
      toast({
        title: 'Import finished',
        description: `${report.totals.create} added, ${report.totals.update} updated, ${report.totals.remove} removed`,
        variant: 'success',
      });
      setPending(null);
    } catch (e) {
      toast({
        title: 'Import failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  const totals = pending?.report.totals;

  return (
    <div className="mt-4 border-t border-line pt-4" data-testid="import-settings">
      <p className="text-[13px] font-medium text-ink">Import an Orbit export</p>
      <p className="text-[12px] text-ink-faint">
        Nothing is written until you confirm; the dry run shows what would change.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Select
          aria-label="Import mode"
          className="w-56"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as ImportMode);
            setPending(null);
          }}
        >
          <option value="merge">Merge — newer copies win</option>
          <option value="replace">Replace — the file is the truth</option>
        </Select>
        <Button size="sm" variant="secondary" onClick={pick} loading={busy}>
          <Import className="size-3.5" aria-hidden="true" /> Choose a file…
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="Orbit export file"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) await preview(await file.text());
          }}
        />
      </div>
      {pending && totals ? (
        <div
          className="mt-3 rounded-md border border-line bg-surface p-3 text-sm"
          data-testid="import-report"
        >
          <p className="font-medium">
            Dry run · schema v{pending.report.schemaVersion} ·{' '}
            {mode === 'merge' ? 'merge' : 'replace'}
          </p>
          <dl className="mt-1 grid grid-cols-4 gap-2 text-[13px]">
            <div>
              <dt className="text-ink-faint">Add</dt>
              <dd className="tnum" data-testid="import-create">
                {totals.create}
              </dd>
            </div>
            <div>
              <dt className="text-ink-faint">Update</dt>
              <dd className="tnum" data-testid="import-update">
                {totals.update}
              </dd>
            </div>
            <div>
              <dt className="text-ink-faint">Unchanged</dt>
              <dd className="tnum" data-testid="import-skip">
                {totals.skip}
              </dd>
            </div>
            <div>
              <dt className="text-ink-faint">Remove</dt>
              <dd className="tnum" data-testid="import-remove">
                {totals.remove}
              </dd>
            </div>
          </dl>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={confirm} loading={busy}>
              Confirm import
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
