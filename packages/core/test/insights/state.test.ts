import { describe, expect, it } from 'vitest';
import { NOW, clockAt } from './helpers';
import {
  applyInsightStates,
  canonicalState,
  dismissState,
  isSuppressing,
  nextSnoozeExpiry,
  restoreState,
  snoozeState,
  snoozeUntilChangeState,
  summarize,
  suppressionReason,
  type Insight,
} from '../../src/insights';
import { normalizeInsightState } from '../../src/schema';

function insight(key = 'stale-project:p1', fingerprint = 'aaaaaaaa00000000'): Insight {
  return {
    key,
    kind: 'stale-project',
    severity: 'attention',
    title: 'Thesis has had no recorded activity for 12 days.',
    detail: '',
    subject: { type: 'project', id: '019372a0-0000-7000-8000-000000000001' },
    evidence: [
      {
        kind: 'activity',
        ref: { type: 'project', id: '019372a0-0000-7000-8000-000000000001' },
        title: null,
        at: NOW.toISOString(),
        deleted: false,
        elapsedDays: 12,
      },
    ],
    threshold: {
      metric: 'staleDays',
      actual: 12,
      operator: '>=',
      limit: 10,
      unit: 'days',
      sampleSize: null,
      minSamples: null,
    },
    metrics: { staleDays: 12 },
    range: null,
    notes: [],
    computedAt: NOW.toISOString(),
    fingerprint,
    algorithmVersion: 1,
  };
}

const HOUR = 3_600_000;

describe('suppression semantics', () => {
  it('a one-day snooze hides for exactly 24 elapsed hours, through source edits, and lifts at the instant', () => {
    const state = snoozeState(undefined, insight(), 'day', clockAt());
    expect(state).toMatchObject({
      insightKey: 'stale-project:p1',
      snoozeMode: 'time',
      snoozedUntil: new Date(NOW.getTime() + 24 * HOUR).toISOString(),
      dismissedAt: null,
      suppressedFingerprint: null,
    });
    expect(state.lastSummary).toEqual(summarize(insight()));
    expect(suppressionReason(state, insight(), NOW)).toBe('snoozed-until');
    expect(suppressionReason(state, insight('stale-project:p1', 'bbbbbbbb00000000'), NOW)).toBe(
      'snoozed-until',
    );
    expect(suppressionReason(state, insight(), new Date(NOW.getTime() + 24 * HOUR - 1))).toBe(
      'snoozed-until',
    );
    expect(suppressionReason(state, insight(), new Date(NOW.getTime() + 24 * HOUR))).toBeNull();
    const week = snoozeState(state, insight(), 'week', clockAt());
    expect(week.id).toBe(state.id);
    expect(week.snoozedUntil).toBe(new Date(NOW.getTime() + 7 * 24 * HOUR).toISOString());
  });

  it('until-data-changes hides while the fingerprint matches, whatever the clock says', () => {
    const state = snoozeUntilChangeState(undefined, insight(), clockAt());
    expect(state).toMatchObject({
      snoozeMode: 'change',
      suppressedFingerprint: 'aaaaaaaa00000000',
      snoozedUntil: null,
    });
    expect(suppressionReason(state, insight(), new Date(NOW.getTime() + 400 * 24 * HOUR))).toBe(
      'until-change',
    );
    expect(
      suppressionReason(state, insight('stale-project:p1', 'bbbbbbbb00000000'), NOW),
    ).toBeNull();
  });

  it('dismissal is permanent for the key until restored; restore clears everything but the summary', () => {
    const dismissed = dismissState(undefined, insight(), clockAt());
    expect(dismissed).toMatchObject({
      dismissedAt: NOW.toISOString(),
      snoozeMode: null,
      snoozedUntil: null,
    });
    expect(
      suppressionReason(
        dismissed,
        insight('stale-project:p1', 'changed0changed0'),
        new Date(NOW.getTime() + 999 * HOUR),
      ),
    ).toBe('dismissed');
    const restored = restoreState(dismissed);
    expect(restored).toMatchObject({
      dismissedAt: null,
      snoozeMode: null,
      snoozedUntil: null,
      suppressedFingerprint: null,
    });
    expect(restored.lastSummary).toEqual(dismissed.lastSummary);
    expect(suppressionReason(restored, insight(), NOW)).toBeNull();
    expect(isSuppressing(restored, NOW)).toBe(false);
    expect(isSuppressing(dismissed, NOW)).toBe(true);
  });

  it('a dated key is its own insight: dismissing one date leaves the next alone', () => {
    const wed = dismissState(
      undefined,
      { ...insight('overloaded-day:2026-09-16'), subject: { type: 'date', date: '2026-09-16' } },
      clockAt(),
    );
    const applied = applyInsightStates(
      [insight('overloaded-day:2026-09-16'), insight('overloaded-day:2026-09-23')],
      [wed],
      NOW,
    );
    expect(applied.active.map((i) => i.key)).toEqual(['overloaded-day:2026-09-23']);
    expect(applied.suppressed.map((s) => [s.insight.key, s.reason])).toEqual([
      ['overloaded-day:2026-09-16', 'dismissed'],
    ]);
  });

  it('picks one canonical row among duplicates by updatedAt then id, ignoring tombstones', () => {
    const older = {
      ...dismissState(undefined, insight(), clockAt()),
      id: '019372a0-0000-7000-8000-000000000002',
      updatedAt: '2026-09-01T00:00:00.000Z',
    };
    const newer = {
      ...snoozeState(undefined, insight(), 'day', clockAt()),
      id: '019372a0-0000-7000-8000-000000000003',
      updatedAt: '2026-09-10T00:00:00.000Z',
    };
    const gone = {
      ...dismissState(undefined, insight(), clockAt()),
      id: '019372a0-0000-7000-8000-000000000001',
      updatedAt: '2026-09-20T00:00:00.000Z',
      deletedAt: '2026-09-20T00:00:00.000Z',
    };
    expect(canonicalState([older, gone, newer])?.id).toBe(newer.id);
    const tie = { ...newer, id: '019372a0-0000-7000-8000-000000000000' };
    expect(canonicalState([newer, tie])?.id).toBe(tie.id);
    expect(canonicalState([gone])).toBeUndefined();
  });

  it('reports the next timed expiry and normalizes legacy rows', () => {
    const soon = snoozeState(undefined, insight('a'), 'day', clockAt());
    const later = snoozeState(undefined, insight('b'), 'week', clockAt());
    const expired = { ...soon, snoozedUntil: new Date(NOW.getTime() - 1).toISOString() };
    expect(nextSnoozeExpiry([later, soon, expired], NOW)).toBe(soon.snoozedUntil);
    expect(nextSnoozeExpiry([expired], NOW)).toBeNull();

    // Week-9 rows: a non-null snooze becomes a timed one; a dismissal stays permanent.
    const legacySnooze = normalizeInsightState({
      id: '019372a0-0000-7000-8000-000000000009',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      deletedAt: null,
      insightKey: 'neglected-goal:demo',
      snoozedUntil: '2099-01-01T00:00:00.000Z',
      dismissedAt: null,
    });
    expect(legacySnooze.record).toMatchObject({
      snoozeMode: 'time',
      suppressedFingerprint: null,
      lastSummary: null,
    });
    expect(legacySnooze.repairs).toEqual([]);
    expect(suppressionReason(legacySnooze.record, insight('neglected-goal:demo'), NOW)).toBe(
      'snoozed-until',
    );
    const legacyDismiss = normalizeInsightState({
      id: '019372a0-0000-7000-8000-000000000009',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      deletedAt: null,
      insightKey: 'x',
      snoozedUntil: null,
      dismissedAt: '2026-09-01T00:00:00.000Z',
      lastSummary: 'not an object',
    }).record;
    expect(legacyDismiss).toMatchObject({
      dismissedAt: '2026-09-01T00:00:00.000Z',
      snoozeMode: null,
      lastSummary: null,
    });
  });
});
