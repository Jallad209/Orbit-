import type { Clock } from '../clock';
import { nowIso } from '../clock';
import { createRecord } from '../records';
import { InsightStateSchema, type InsightState, type InsightSummary } from '../schema';
import type { Insight } from './types';

/**
 * Suppression semantics, as pure record transformations. The app writes
 * what these return inside one owned transaction (`@orbit/storage`
 * `writeInsightState`); reading a page never writes.
 *
 * | Action             | Effect                                                             |
 * | ------------------ | ------------------------------------------------------------------ |
 * | snooze 1 day       | hidden for exactly 24 elapsed hours from the action                |
 * | snooze 1 week      | hidden for exactly 7 × 24 elapsed hours                            |
 * | until data changes | hidden while the insight's fingerprint equals the one recorded     |
 * | dismiss            | hidden for this key until restored, whatever the numbers do        |
 * | restore            | every field cleared; the next computation shows it again           |
 *
 * A timed snooze stays in force through source edits until its deadline and
 * stops at the exact instant. A dismissal does not return because the
 * numbers changed. A dated key (`overloaded-day:2026-09-16`) is its own
 * insight: dismissing one Wednesday does not dismiss the next.
 */

export type SnoozeDuration = 'day' | 'week';
export const SNOOZE_MS: Record<SnoozeDuration, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

export type SuppressionReason = 'dismissed' | 'snoozed-until' | 'until-change';

/** Why an insight is hidden right now, or null when it is not. */
export function suppressionReason(
  state: InsightState | undefined,
  insight: Pick<Insight, 'fingerprint'>,
  now: Date,
): SuppressionReason | null {
  if (!state || state.deletedAt !== null) return null;
  if (state.dismissedAt !== null) return 'dismissed';
  if (state.snoozeMode === 'time') {
    return state.snoozedUntil !== null && now.toISOString() < state.snoozedUntil
      ? 'snoozed-until'
      : null;
  }
  if (state.snoozeMode === 'change') {
    return state.suppressedFingerprint === insight.fingerprint ? 'until-change' : null;
  }
  return null;
}

/** The part of an insight the history view keeps once its data has moved on. */
export function summarize(insight: Insight): InsightSummary {
  return {
    version: 1,
    kind: insight.kind,
    severity: insight.severity,
    title: insight.title,
    detail: insight.detail,
    subject: insight.subject,
    metrics: { ...insight.metrics },
  };
}

function base(current: InsightState | undefined, key: string, clock: Clock): InsightState {
  return (
    current ??
    createRecord(InsightStateSchema, clock, {
      insightKey: key,
      snoozedUntil: null,
      dismissedAt: null,
      snoozeMode: null,
      suppressedFingerprint: null,
      lastSummary: null,
    })
  );
}

export function snoozeState(
  current: InsightState | undefined,
  insight: Insight,
  duration: SnoozeDuration,
  clock: Clock,
): InsightState {
  const at = clock.now().getTime();
  return InsightStateSchema.parse({
    ...base(current, insight.key, clock),
    deletedAt: null,
    dismissedAt: null,
    snoozeMode: 'time',
    snoozedUntil: new Date(at + SNOOZE_MS[duration]).toISOString(),
    suppressedFingerprint: null,
    lastSummary: summarize(insight),
  });
}

export function snoozeUntilChangeState(
  current: InsightState | undefined,
  insight: Insight,
  clock: Clock,
): InsightState {
  return InsightStateSchema.parse({
    ...base(current, insight.key, clock),
    deletedAt: null,
    dismissedAt: null,
    snoozeMode: 'change',
    snoozedUntil: null,
    suppressedFingerprint: insight.fingerprint,
    lastSummary: summarize(insight),
  });
}

export function dismissState(
  current: InsightState | undefined,
  insight: Insight,
  clock: Clock,
): InsightState {
  return InsightStateSchema.parse({
    ...base(current, insight.key, clock),
    deletedAt: null,
    dismissedAt: nowIso(clock),
    snoozeMode: null,
    snoozedUntil: null,
    suppressedFingerprint: null,
    lastSummary: summarize(insight),
  });
}

/** Clear every suppression field; the summary stays for the record. */
export function restoreState(current: InsightState): InsightState {
  return InsightStateSchema.parse({
    ...current,
    dismissedAt: null,
    snoozeMode: null,
    snoozedUntil: null,
    suppressedFingerprint: null,
  });
}

/** Whether a state row still hides or remembers anything worth listing. */
export function isSuppressing(state: InsightState, now: Date): boolean {
  if (state.deletedAt !== null) return false;
  if (state.dismissedAt !== null) return true;
  if (state.snoozeMode === 'time')
    return state.snoozedUntil !== null && now.toISOString() < state.snoozedUntil;
  return state.snoozeMode === 'change';
}

/**
 * Pick the canonical row among duplicates for one key (legacy or imported
 * data can hold several): the newest `updatedAt`, then the smallest id.
 * The others are retired by the caller inside the same transaction.
 */
export function canonicalState(rows: readonly InsightState[]): InsightState | undefined {
  const live = rows.filter((r) => r.deletedAt === null);
  if (!live.length) return undefined;
  return [...live].sort(
    (a, b) =>
      (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0) ||
      (a.id < b.id ? -1 : 1),
  )[0];
}

export interface AppliedInsights {
  active: Insight[];
  suppressed: Array<{ insight: Insight; state: InsightState; reason: SuppressionReason }>;
}

/** Split computed insights by their suppression state; nothing is written. */
export function applyInsightStates(
  insights: readonly Insight[],
  states: readonly InsightState[],
  now: Date,
): AppliedInsights {
  const byKey = new Map<string, InsightState[]>();
  for (const s of states) {
    const list = byKey.get(s.insightKey);
    if (list) list.push(s);
    else byKey.set(s.insightKey, [s]);
  }
  const out: AppliedInsights = { active: [], suppressed: [] };
  for (const insight of insights) {
    const state = canonicalState(byKey.get(insight.key) ?? []);
    const reason = suppressionReason(state, insight, now);
    if (reason && state) out.suppressed.push({ insight, state, reason });
    else out.active.push(insight);
  }
  return out;
}

/** The earliest future snooze expiry among `states`, for one scheduled refresh. */
export function nextSnoozeExpiry(states: readonly InsightState[], now: Date): string | null {
  const at = now.toISOString();
  let next: string | null = null;
  for (const s of states) {
    if (s.deletedAt !== null || s.snoozeMode !== 'time' || s.snoozedUntil === null) continue;
    if (s.snoozedUntil <= at) continue;
    if (next === null || s.snoozedUntil < next) next = s.snoozedUntil;
  }
  return next;
}
