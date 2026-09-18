import type { BackupCandidate } from '@orbit/storage';
import { Archive, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/Dialog';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { usePlatform } from '@/platform';

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Desktop: the backups folder next to the data file, with Restore. */
export function BackupList() {
  const platform = usePlatform();
  const desktop = platform.desktop;
  const { data: backups, refresh } = useRepoQuery(
    async () => (desktop ? desktop.listBackups() : []),
    [],
  );
  const [restoring, setRestoring] = useState<BackupCandidate | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  if (!desktop) return null;

  const restore = async () => {
    if (!restoring) return;
    setRestoreBusy(true);
    try {
      await desktop.restoreBackup(restoring.path);
    } catch (e) {
      setRestoreBusy(false);
      toast({
        title: 'Restore failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'danger',
      });
    }
  };

  const backupNow = async () => {
    setBackupBusy(true);
    try {
      const created = await desktop.backupNow();
      toast({
        title: 'Backup created',
        description: fileName(created.path),
        variant: 'success',
      });
      refresh();
    } catch (error) {
      toast({
        title: 'Backup failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'danger',
      });
    } finally {
      setBackupBusy(false);
    }
  };

  const rows = [...(backups ?? [])].sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));

  return (
    <div className="mt-4 border-t border-line pt-4" data-testid="backup-list">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-ink">Backups</p>
        <Button size="sm" variant="secondary" loading={backupBusy} onClick={backupNow}>
          Back up now
        </Button>
      </div>
      <p className="text-[12px] text-ink-faint">
        Copies in the <code className="font-mono">backups</code> folder next to your data file.
        Restoring verifies the backup, saves a copy of the current data here, and reloads Orbit.
      </p>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-muted">No backups yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1" aria-label="Backups">
          {rows.map((b) => (
            <li key={b.path} className="flex items-center gap-2 text-sm">
              <Archive className="size-4 text-ink-faint" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                {fileName(b.path)}
              </span>
              <Badge tone="outline">{b.kind.replace('-', ' ')}</Badge>
              <span className="text-[12px] text-ink-faint tnum">
                {b.modifiedAt.slice(0, 16).replace('T', ' ')} · {sizeLabel(b.sizeBytes)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Restore ${fileName(b.path)}`}
                onClick={() => setRestoring(b)}
                disabled={b.sizeBytes === 0}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" /> Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={restoring !== null} onOpenChange={(o) => (o ? undefined : setRestoring(null))}>
        <DialogContent size="sm">
          <DialogTitle>Restore this backup?</DialogTitle>
          <DialogDescription>
            {restoring ? fileName(restoring.path) : ''} replaces the current data file. The current
            data is saved in the backups folder first, and Orbit reloads.
          </DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRestoring(null)} disabled={restoreBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={restore} loading={restoreBusy}>
              Restore and reload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
