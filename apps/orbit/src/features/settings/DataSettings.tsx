import { exportJson, serializeExport } from '@orbit/storage';
import { toLocalDate } from '@orbit/core';
import { Download, FolderOpen, HardDrive, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Toggle } from '@/components/ui/Checkbox';
import { toast } from '@/components/ui/toastStore';
import { useAppStore } from '@/app/store';
import { usePlatform, useRepository } from '@/platform';

/**
 * Data section of Settings. Desktop: the data folder, integrity status, and
 * close-to-tray. Web: honest storage status. Both: export.
 */
export function DataSettings() {
  const platform = usePlatform();
  const repo = useRepository();
  const storage = useAppStore((s) => s.storageStatus);
  const closeToTray = useAppStore((s) => s.closeToTray);
  const setCloseToTray = useAppStore((s) => s.setCloseToTray);
  const [busy, setBusy] = useState(false);
  const desktop = platform.desktop;
  const status = desktop?.dataFileStatus() ?? null;

  const exportNow = async () => {
    setBusy(true);
    try {
      const name = `orbit-export-${toLocalDate(new Date())}.json`;
      await platform.exportFile(name, serializeExport(await exportJson(repo)));
      toast({ title: 'Export saved', description: name, variant: 'success' });
    } catch (e) {
      toast({
        title: 'Export failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  const changeFolder = async () => {
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

  return (
    <Card data-testid="data-settings">
      <SectionHeader title="Data" />
      {desktop ? (
        <div className="flex flex-col gap-3 text-sm">
          <div>
            <p className="text-[13px] text-ink-muted">Data folder</p>
            <p className="truncate font-mono text-[13px]" data-testid="data-dir">
              {status?.dir ?? '—'}
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="secondary" onClick={changeFolder} disabled={busy}>
                <FolderOpen className="size-3.5" aria-hidden="true" /> Change…
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void desktop.revealDataFolder()}>
                Show in Explorer
              </Button>
            </div>
            <p className="mt-1 text-[12px] text-ink-faint">
              Orbit copies and verifies your data before switching folders. The original file stays
              in the old folder. Choose a folder without an existing Orbit database.
            </p>
          </div>
          <div className="flex items-center gap-2" data-testid="integrity">
            {status?.integrity.ok ? (
              <ShieldCheck className="size-4 text-ok" aria-hidden="true" />
            ) : (
              <ShieldAlert className="size-4 text-danger" aria-hidden="true" />
            )}
            <span>
              Integrity check at startup:{' '}
              <Badge tone={status?.integrity.ok ? 'ok' : 'danger'}>
                {status ? (status.integrity.ok ? 'ok' : 'problem found') : 'not run'}
              </Badge>
            </span>
            {status?.integrity.fts5 ? <Badge tone="outline">FTS5</Badge> : null}
          </div>
          {status?.recovery ? (
            <p className="text-[13px] text-gold-ink" data-testid="recovery">
              The data file was damaged. It was moved to{' '}
              <code className="font-mono">{status.recovery.quarantinedTo}</code>
              {status.recovery.restoredFrom
                ? ` and the backup ${status.recovery.restoredFrom} was restored.`
                : ' and a fresh file was created; no backup was available.'}
            </p>
          ) : null}
          <div className="w-64">
            <Toggle
              label="Close to tray"
              description={
                platform.capabilities.tray
                  ? 'Keep Orbit running when the window closes.'
                  : 'Not available in this version.'
              }
              disabled={!platform.capabilities.tray}
              checked={platform.capabilities.tray && closeToTray}
              onCheckedChange={setCloseToTray}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 text-sm" data-testid="web-storage">
          <p className="flex items-center gap-2">
            <HardDrive className="size-4 text-ink-muted" aria-hidden="true" />
            Data lives in this browser&apos;s storage.{' '}
            <Badge tone={storage?.persisted ? 'ok' : 'gold'}>
              {storage === null ? 'checking…' : storage.persisted ? 'persistent' : 'not guaranteed'}
            </Badge>
          </p>
          <p className="text-[13px] text-ink-muted">
            A browser may clear site data under pressure. Install the desktop app for a real data
            file, or export regularly.
          </p>
        </div>
      )}
      <div className="mt-4">
        <Button size="sm" variant="gold" loading={busy} onClick={exportNow}>
          <Download className="size-3.5" aria-hidden="true" /> Export everything as JSON
        </Button>
      </div>
    </Card>
  );
}
