import { exportJson, serializeExport } from '@orbit/storage';
import { toLocalDate } from '@orbit/core';
import { Download, HardDrive, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAppStore } from '@/app/store';
import { usePlatform, useRepository } from '@/platform';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/toastStore';

function formatBytes(n: number | null): string | null {
  if (n === null) return null;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * On the web runtime, asks the browser for persistent storage once and warns
 * when it is refused, because the browser may then evict Orbit's data under
 * pressure. Desktop never shows this.
 */
export function StorageBanner() {
  const platform = usePlatform();
  const repo = useRepository();
  const [exporting, setExporting] = useState(false);
  const status = useAppStore((s) => s.storageStatus);
  const dismissed = useAppStore((s) => s.storageBannerDismissed);
  const setStatus = useAppStore((s) => s.setStorageStatus);
  const dismiss = useAppStore((s) => s.dismissStorageBanner);

  useEffect(() => {
    if (platform.capabilities.dataFolder) return;
    let cancelled = false;
    platform.requestPersistentStorage().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [platform, setStatus]);

  if (platform.capabilities.dataFolder || dismissed || !status || status.persisted) return null;

  const usage = formatBytes(status.usageBytes);

  const exportNow = async () => {
    setExporting(true);
    try {
      const envelope = await exportJson(repo);
      const name = `orbit-export-${toLocalDate(new Date())}.json`;
      await platform.exportFile(name, serializeExport(envelope));
      toast({ title: 'Export saved', description: name });
    } catch (e) {
      toast({
        title: 'Export failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'danger',
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      role="status"
      data-testid="storage-banner"
      className="flex items-center gap-3 border-b border-gold-2/60 bg-gold-2/30 px-4 py-2 text-[13px] text-gold-ink"
    >
      <HardDrive className="size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">
          This browser has not promised to keep Orbit&apos;s data.
        </span>{' '}
        It may clear it under storage pressure. Install Orbit or export regularly.
        {usage ? <span className="ml-1 text-gold-ink/70">Using {usage}.</span> : null}
      </p>
      <Button size="sm" variant="gold" loading={exporting} onClick={exportNow}>
        <Download className="size-3.5" aria-hidden="true" />
        Export now
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={dismiss}>
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
