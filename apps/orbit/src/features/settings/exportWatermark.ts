import type { ExportEnvelope } from '@orbit/storage';

export const EXPORT_WATERMARK_KEY = 'orbit-export-watermark';
export const EXPORT_NAG_DAYS = 7;
export const EXPORT_NAG_OPS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ExportWatermark {
  at: string;
  seq: number;
}

export function readExportWatermark(): ExportWatermark | null {
  try {
    const value = JSON.parse(localStorage.getItem(EXPORT_WATERMARK_KEY) ?? 'null') as unknown;
    if (!value || typeof value !== 'object') return null;
    const { at, seq } = value as Partial<ExportWatermark>;
    if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) return null;
    if (!Number.isInteger(seq) || seq! < 0) return null;
    return { at, seq: seq! };
  } catch {
    return null;
  }
}

export function writeExportWatermark(value: ExportWatermark): void {
  try {
    localStorage.setItem(EXPORT_WATERMARK_KEY, JSON.stringify(value));
  } catch {
    /* A blocked localStorage means the reminder remains best effort. */
  }
}

export function ensureExportBaseline(latestSeq: number, nowMs = Date.now()): ExportWatermark {
  const existing = readExportWatermark();
  if (existing && existing.seq <= latestSeq) return existing;
  const baseline = { at: new Date(nowMs).toISOString(), seq: latestSeq };
  writeExportWatermark(baseline);
  return baseline;
}

export function exportReminderDue(
  watermark: ExportWatermark,
  nowMs: number,
  latestSeq: number,
): boolean {
  if (watermark.seq > latestSeq) return false;
  return (
    nowMs - Date.parse(watermark.at) > EXPORT_NAG_DAYS * DAY_MS &&
    latestSeq - watermark.seq > EXPORT_NAG_OPS
  );
}

export function recordExport(envelope: Pick<ExportEnvelope, 'exportedAt' | 'opLogSeq'>): void {
  writeExportWatermark({ at: envelope.exportedAt, seq: envelope.opLogSeq });
}
