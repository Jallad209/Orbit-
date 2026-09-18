import { exportJson, serializeExport } from '@orbit/storage';
import type { Repository } from '@orbit/storage';
import { systemClock, toLocalDate } from '@orbit/core';
import type { Clock } from '@orbit/core';
import type { Platform } from '@/platform';
import { recordExport } from './exportWatermark';

export async function exportJsonToFile(
  platform: Platform,
  repo: Repository,
  clock: Clock = systemClock,
): Promise<boolean> {
  const envelope = await exportJson(repo, clock);
  const name = `orbit-export-${toLocalDate(clock.now())}.json`;
  const saved = await platform.exportFile(name, serializeExport(envelope));
  if (saved) recordExport(envelope);
  return saved;
}
