import { exportMarkdown, markdownAnchor } from '@orbit/storage';
import { systemClock, toLocalDate } from '@orbit/core';
import type { Clock } from '@orbit/core';
import { Download, FileText, FolderOpen, HardDrive, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { toast } from '@/components/ui/toastStore';
import { useAppStore } from '@/app/store';
import { usePlatform, useRepository } from '@/platform';
import { BackupList } from './BackupList';
import { ImportSettings } from './ImportSettings';
import { exportJsonToFile } from './exportService';

/**
 * Data section of Settings. Desktop: the data folder and integrity status
 * (close-to-tray moved to the Desktop section in week 11). Web: honest
 * storage status. Both: export.
 */
export function DataSettings({ clock = systemClock }: { clock?: Clock } = {}) {
  const platform = usePlatform();
  const repo = useRepository();
  const storage = useAppStore((s) => s.storageStatus);
  const [busy, setBusy] = useState(false);
  const desktop = platform.desktop;
  const status = desktop?.dataFileStatus() ?? null;

  const exportNow = async (format: 'json' | 'markdown') => {
    setBusy(true);
    try {
      const date = toLocalDate(clock.now());
      const name = format === 'json' ? `orbit-export-${date}.json` : `orbit-export-${date}.md`;
      let saved: boolean;
      if (format === 'json') {
        saved = await exportJsonToFile(platform, repo, clock);
      } else {
        saved = await platform.exportFile(
          name,
          bundleMarkdown(await exportMarkdown(repo, { singleDocument: true })),
          'text/markdown',
        );
      }
      if (saved) toast({ title: 'Export saved', description: name, variant: 'success' });
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
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="gold" loading={busy} onClick={() => exportNow('json')}>
          <Download className="size-3.5" aria-hidden="true" /> Export everything as JSON
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => exportNow('markdown')}>
          <FileText className="size-3.5" aria-hidden="true" /> Export as Markdown
        </Button>
      </div>
      <ImportSettings />
      <BackupList />
    </Card>
  );
}

/** One readable document out of the per-project and per-note files. */
export function bundleMarkdown(files: ReadonlyArray<{ path: string; content: string }>): string {
  return files
    .map(
      (f) =>
        `<!-- ${f.path} -->\n<a id="${markdownAnchor(f.path)}"></a>\n\n${f.content.trimEnd()}\n`,
    )
    .join('\n---\n\n');
}
