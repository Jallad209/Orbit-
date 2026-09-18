import { systemClock } from '@orbit/core';
import type { Clock } from '@orbit/core';
import { Download, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { Repository } from '@orbit/storage';
import { useAppStore } from '@/app/store';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { exportJsonToFile } from '@/features/settings/exportService';
import { ensureExportBaseline, exportReminderDue } from '@/features/settings/exportWatermark';
import { usePlatform, useRepository } from '@/platform';

export function ExportReminder({ clock = systemClock }: { clock?: Clock }) {
  const platform = usePlatform();
  const repo = useRepository();
  const dismissed = useAppStore((state) => state.exportReminderDismissed);
  const dismiss = useAppStore((state) => state.dismissExportReminder);
  const storage = useAppStore((state) => state.storageStatus);
  const storageDismissed = useAppStore((state) => state.storageBannerDismissed);
  const [exporting, setExporting] = useState(false);
  const query = useCallback(
    async (repository: Repository) => {
      const latestSeq = await repository.opLog.latestSeq();
      const nowMs = clock.now().getTime();
      const watermark = ensureExportBaseline(latestSeq, nowMs);
      return {
        due: exportReminderDue(watermark, nowMs, latestSeq),
        days: Math.floor((nowMs - Date.parse(watermark.at)) / 86_400_000),
        operations: Math.max(0, latestSeq - watermark.seq),
      };
    },
    [clock],
  );
  const { data, refresh } = useRepoQuery(query, [query]);
  const storageBannerVisible =
    !platform.capabilities.dataFolder && !storageDismissed && !!storage && !storage.persisted;

  if (platform.capabilities.dataFolder || dismissed || storageBannerVisible || !data?.due) {
    return null;
  }

  const exportNow = async () => {
    setExporting(true);
    try {
      const saved = await exportJsonToFile(platform, repo, clock);
      if (saved) {
        toast({ title: 'Export saved', description: 'Your JSON export is up to date.' });
        refresh();
      }
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'danger',
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      role="status"
      data-testid="export-reminder"
      className="flex items-center gap-3 border-b border-gold-2/60 bg-gold-2/20 px-4 py-2 text-[13px] text-gold-ink"
    >
      <Download className="size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        It has been {data.days} days and {data.operations} changes since your last full backup.
        Export everything as JSON.
      </p>
      <Button size="sm" variant="secondary" loading={exporting} onClick={exportNow}>
        Export now
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={dismiss}>
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
