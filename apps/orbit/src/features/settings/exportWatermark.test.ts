import { beforeEach, describe, expect, it } from 'vitest';
import {
  EXPORT_WATERMARK_KEY,
  ensureExportBaseline,
  exportReminderDue,
  readExportWatermark,
  recordExport,
} from './exportWatermark';

const NOW = Date.parse('2026-09-17T12:00:00.000Z');
const EIGHT_DAYS_AGO = '2026-09-09T11:59:59.999Z';

describe('export watermark', () => {
  beforeEach(() => localStorage.clear());

  it('gives a fresh install a baseline instead of immediately nagging', () => {
    const watermark = ensureExportBaseline(101, NOW);

    expect(watermark).toEqual({ at: '2026-09-17T12:00:00.000Z', seq: 101 });
    expect(readExportWatermark()).toEqual(watermark);
    expect(exportReminderDue(watermark, NOW, 101)).toBe(false);
  });

  it('is due only after both seven days and one hundred operations', () => {
    const old = { at: EIGHT_DAYS_AGO, seq: 10 };

    expect(exportReminderDue(old, NOW, 111)).toBe(true);
    expect(exportReminderDue(old, NOW, 110)).toBe(false);
    expect(exportReminderDue({ at: '2026-09-11T12:00:00.000Z', seq: 10 }, NOW, 510)).toBe(false);
  });

  it('stops being due after a JSON export records its envelope watermark', () => {
    localStorage.setItem(EXPORT_WATERMARK_KEY, JSON.stringify({ at: EIGHT_DAYS_AGO, seq: 0 }));
    recordExport({ exportedAt: '2026-09-17T12:00:00.000Z', opLogSeq: 101 });

    const watermark = readExportWatermark()!;
    expect(watermark).toEqual({ at: '2026-09-17T12:00:00.000Z', seq: 101 });
    expect(exportReminderDue(watermark, NOW, 101)).toBe(false);
  });

  it.each([
    ['a watermark from a reset database', JSON.stringify({ at: EIGHT_DAYS_AGO, seq: 900 })],
    ['corrupt JSON', '{broken'],
  ])('rewrites %s as a fresh baseline', (_label, stored) => {
    localStorage.setItem(EXPORT_WATERMARK_KEY, stored);

    expect(ensureExportBaseline(50, NOW)).toEqual({
      at: '2026-09-17T12:00:00.000Z',
      seq: 50,
    });
    expect(readExportWatermark()).toEqual({ at: '2026-09-17T12:00:00.000Z', seq: 50 });
  });
});
