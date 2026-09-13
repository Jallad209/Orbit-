import type { BackupCandidate } from '@orbit/storage';
import { Archive, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
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
  const { data: backups } = useRepoQuery(async () => (desktop ? desktop.listBackups() : []), []);
  const [restoring, setRestoring] = useState<BackupCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  if (!desktop) return null;

  const restore = async () => {
    if (!restoring) return;
    setBusy(true);
    try {
      await desktop.restoreBackup(restoring.path);
    } catch (e) {
      setBusy(false);
      toast({
        title: 'Restore failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'danger',
      });
    }
  };

  const rows = [...(backups ?? [])].sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));

  return (
    <div className="mt-4 border-t border-line pt-4" data-testid="backup-list">
      <p className="text-[13px] font-medium text-ink">Backups</p>
      <p className="text-[12px] text-ink-faint">
        Copies in the <code className="font-mono">backups</code> folder next to your data file.
        Restoring keeps the current file aside and reloads Orbit.
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
            file is kept beside it, and Orbit reloads.
          </DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRestoring(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={restore} loading={busy}>
              Restore and reload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
