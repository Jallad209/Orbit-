import { describe, expect, it } from 'vitest';
import { clockAt } from './helpers';
import {
  DEFAULT_INSIGHT_SETTINGS,
  INSIGHT_SETTINGS_FIELDS,
  insightInputsFor,
  validateInsightSettings,
} from '../../src/insights';
import { APP_SETTINGS_ID, AppSettingsSchema, normalizeAppSettings } from '../../src/schema';
import { defaultAppSettings } from '../../src/settings';

const BASE = {
  id: APP_SETTINGS_ID,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  deletedAt: null,
};

describe('insight settings', () => {
  it('has the documented defaults and bounds', () => {
    expect(DEFAULT_INSIGHT_SETTINGS).toEqual({
      staleProjectDays: 10,
      estimateWindowDays: 30,
      estimateMinSamples: 5,
      estimateRatioThreshold: 1.3,
      dayOverloadRatio: 1.1,
      personCommitmentCount: 3,
    });
    expect(INSIGHT_SETTINGS_FIELDS.map((f) => [f.key, f.min, f.max])).toEqual([
      ['staleProjectDays', 1, 90],
      ['estimateWindowDays', 7, 180],
      ['estimateMinSamples', 5, 100],
      ['estimateRatioThreshold', 1.05, 3],
      ['dayOverloadRatio', 1, 2],
      ['personCommitmentCount', 1, 20],
    ]);
    expect(defaultAppSettings(clockAt()).insights).toEqual(DEFAULT_INSIGHT_SETTINGS);
  });

  it('rejects out-of-bounds or non-integer input visibly, per field', () => {
    const bad = validateInsightSettings({
      ...DEFAULT_INSIGHT_SETTINGS,
      staleProjectDays: 0,
      estimateRatioThreshold: 1,
      estimateMinSamples: 5.5,
    });
    expect(bad).toEqual({
      ok: false,
      errors: {
        staleProjectDays: 'Use a whole number between 1 and 90.',
        estimateRatioThreshold: 'Use a number between 1.05 and 3.',
        estimateMinSamples: 'Use a whole number between 5 and 100.',
      },
    });
    expect(validateInsightSettings({ ...DEFAULT_INSIGHT_SETTINGS, dayOverloadRatio: 2 })).toEqual({
      ok: true,
      settings: { ...DEFAULT_INSIGHT_SETTINGS, dayOverloadRatio: 2 },
    });
    expect(() =>
      AppSettingsSchema.parse({ ...BASE, insights: { staleProjectDays: 91 } }),
    ).toThrow();
  });

  it('gives an old settings document the defaults without touching planning fields', () => {
    const old = {
      ...BASE,
      workingWindow: { startMin: 480, endMin: 960 },
      restBoundaries: [],
      bufferMin: 5,
      defaultEstimateMin: 45,
      eveningStartMin: 1000,
    };
    const { record, repairs } = normalizeAppSettings(old);
    expect(repairs).toEqual([]);
    expect(record).toEqual({ ...old, insights: DEFAULT_INSIGHT_SETTINGS });
  });

  it('repairs malformed present values field by field and reports them', () => {
    const { record, repairs } = normalizeAppSettings({
      ...BASE,
      bufferMin: 'ten',
      insights: { staleProjectDays: 0, estimateWindowDays: 60, dayOverloadRatio: 'high' },
    });
    expect(repairs).toEqual([
      'bufferMin',
      'insights.staleProjectDays',
      'insights.dayOverloadRatio',
    ]);
    expect(record.bufferMin).toBe(10);
    expect(record.insights).toEqual({ ...DEFAULT_INSIGHT_SETTINGS, estimateWindowDays: 60 });
    const whole = normalizeAppSettings({ ...BASE, insights: 7 });
    expect(whole.repairs).toEqual(['insights']);
    expect(whole.record.insights).toEqual(DEFAULT_INSIGHT_SETTINGS);
    expect(() => normalizeAppSettings({ ...BASE, id: 'nope' })).toThrow();
    expect(() => normalizeAppSettings('text')).toThrow();
  });

  it('splits the document into the two groups the engine reads', () => {
    const settings = AppSettingsSchema.parse({
      ...BASE,
      defaultEstimateMin: 20,
      insights: { staleProjectDays: 3 },
    });
    expect(insightInputsFor(settings)).toEqual({
      settings: { ...DEFAULT_INSIGHT_SETTINGS, staleProjectDays: 3 },
      planning: {
        workingWindow: { startMin: 540, endMin: 1080 },
        restBoundaries: [{ startMin: 750, endMin: 795 }],
        defaultEstimateMin: 20,
      },
    });
  });
});
