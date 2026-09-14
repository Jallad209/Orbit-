import {
  applyInsightStates,
  buildInsightIndex,
  computeDayLoad,
  computeInsights,
  dismissState,
  insightInputsFor,
  isSuppressing,
  nextSnoozeExpiry,
  restoreState,
  snoozeState,
  snoozeUntilChangeState,
  systemClock,
} from '@orbit/core';
import type {
  AppSettings,
  Clock,
  DayLoad,
  Insight,
  InsightReport,
  InsightSnapshot,
  InsightState,
  InsightSummary,
  LocalDate,
  SnoozeDuration,
  SuppressionReason,
} from '@orbit/core';
import { readInsightStates, writeInsightState } from '@orbit/storage';
import type { Repository } from '@orbit/storage';
import { bumpData } from '@/data/useQuery';
import { readSettings } from '@/features/settings/settingsService';

/**
 * The insight snapshot service (week 11): one coherent read of the
 * repository, one `computeInsights` call, the suppression state applied,
 * and the transactional snooze/dismiss/restore writes. Every surface
 * (Insights page, Today strip, Timeline header) reads the same view through
 * `InsightsProvider`, so nothing is computed twice per data generation.
 */

export interface HistoryEntry {
  key: string;
  state: InsightState;
  /** The stored summary, or the live insight's when it is still current. */
  summary: InsightSummary | null;
  live: Insight | null;
  status: SuppressionReason;
  /** For timed snoozes: when it lifts. */
  until: string | null;
}

export interface InsightView {
  report: InsightReport;
  /** Sorted, unsuppressed. */
  active: Insight[];
  suppressed: Array<{ insight: Insight; state: InsightState; reason: SuppressionReason }>;
  history: HistoryEntry[];
  settings: AppSettings;
  /** Op-log head at read time; another window's commit moves it. */
  opLogSeq: number;
  /** The earliest instant at which time alone changes this view, or null. */
  nextBoundaryAt: string | null;
}

/** Read every store the engine needs, tombstones included where they count. */
export async function loadInsightSnapshot(repo: Repository): Promise<InsightSnapshot> {
  const [
    areas,
    goals,
    projects,
    milestones,
    tasks,
    sessions,
    events,
    routines,
    routineInstances,
    blocks,
    dayCommitments,
    people,
    commitments,
    rules,
  ] = await Promise.all([
    repo.areas.list(),
    repo.goals.list(),
    repo.projects.list(),
    repo.milestones.list({ includeDeleted: true }),
    repo.tasks.list({ includeDeleted: true }),
    repo.sessions.list(),
    repo.events.list(),
    repo.routines.list(),
    repo.routineInstances.list(),
    repo.blocks.list(),
    repo.dayCommitments.list(),
    repo.people.list(),
    repo.commitments.list(),
    repo.rules.list(),
  ]);
  return {
    areas,
    goals,
    projects,
    milestones,
    tasks,
    sessions,
    events,
    routines,
    routineInstances,
    blocks,
    dayCommitments,
    people,
    commitments,
    rules,
  };
}

function earliest(instants: Array<string | null>): string | null {
  let out: string | null = null;
  for (const at of instants) if (at && (out === null || at < out)) out = at;
  return out;
}

/** Everything the surfaces show, from one read. Nothing is written. */
export async function loadInsightView(
  repo: Repository,
  clock: Clock = systemClock,
): Promise<InsightView> {
  const [snapshot, settings, states, opLogSeq] = await Promise.all([
    loadInsightSnapshot(repo),
    readSettings(repo, clock),
    readInsightStates(repo),
    repo.opLog.latestSeq(),
  ]);
  const inputs = insightInputsFor(settings);
  const report = computeInsights({ snapshot, ...inputs, clock });
  const now = clock.now();
  const applied = applyInsightStates(report.insights, states, now);
  const liveByKey = new Map(report.insights.map((i) => [i.key, i]));
  const history: HistoryEntry[] = states
    .filter((s) => isSuppressing(s, now))
    .map((state) => {
      const live = liveByKey.get(state.insightKey) ?? null;
      const status: SuppressionReason =
        state.dismissedAt !== null
          ? 'dismissed'
          : state.snoozeMode === 'time'
            ? 'snoozed-until'
            : 'until-change';
      return {
        key: state.insightKey,
        state,
        summary: state.lastSummary ?? (live ? summaryOf(live) : null),
        live,
        status,
        until: state.snoozeMode === 'time' ? state.snoozedUntil : null,
      };
    })
    .sort((a, b) => (a.state.updatedAt < b.state.updatedAt ? 1 : -1));
  return {
    report,
    active: applied.active,
    suppressed: applied.suppressed,
    history,
    settings,
    opLogSeq,
    nextBoundaryAt: earliest([
      report.boundaries.nextStaleAt,
      report.boundaries.nextSampleExpiryAt,
      report.boundaries.nextMidnightAt,
      nextSnoozeExpiry(states, now),
    ]),
  };
}

function summaryOf(insight: Insight): InsightSummary {
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

/** The day-load helper for any date, for the Timeline header outside the seven-date horizon. */
export async function loadDayLoad(
  repo: Repository,
  date: LocalDate,
  clock: Clock = systemClock,
): Promise<DayLoad> {
  const [snapshot, settings] = await Promise.all([
    loadInsightSnapshot(repo),
    readSettings(repo, clock),
  ]);
  const inputs = insightInputsFor(settings);
  const index = buildInsightIndex(snapshot, clock.now());
  return computeDayLoad(date, snapshot, index, inputs.planning, inputs.settings);
}

export type SnoozeChoice = SnoozeDuration | 'change';

export async function snoozeInsight(
  repo: Repository,
  insight: Insight,
  choice: SnoozeChoice,
  clock: Clock = systemClock,
): Promise<InsightState> {
  const written = await writeInsightState(
    repo,
    insight.key,
    (current) =>
      choice === 'change'
        ? snoozeUntilChangeState(current, insight, clock)
        : snoozeState(current, insight, choice, clock),
    clock,
  );
  bumpData();
  return written!.state;
}

export async function dismissInsight(
  repo: Repository,
  insight: Insight,
  clock: Clock = systemClock,
): Promise<InsightState> {
  const written = await writeInsightState(
    repo,
    insight.key,
    (current) => dismissState(current, insight, clock),
    clock,
  );
  bumpData();
  return written!.state;
}

/** Clear a key's suppression. Returns null when there was nothing to restore. */
export async function restoreInsight(
  repo: Repository,
  key: string,
  clock: Clock = systemClock,
): Promise<InsightState | null> {
  const written = await writeInsightState(
    repo,
    key,
    (current) => (current ? restoreState(current) : null),
    clock,
  );
  if (written) bumpData();
  return written?.state ?? null;
}
