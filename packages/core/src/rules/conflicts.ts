import { formatMinute } from '../dates';
import type { Id, Rule } from '../schema';
import { rulesInOrder } from './order';

/**
 * Rules that contradict each other. Detection is advisory: the planner
 * still applies every enabled rule in order, and the settings list badges
 * both rules in a conflict with the message so the user can decide.
 */
export interface RuleConflict {
  /** Both rules involved, so each can carry the badge. */
  ruleIds: [Id, Id];
  message: string;
}

const WEEKDAY_NAME: Record<string, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
};

function label(rule: Rule): string {
  return rule.name || rule.type;
}

function overlap(a: { startMin: number; endMin: number }, b: { startMin: number; endMin: number }) {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

export function detectConflicts(rules: readonly Rule[]): RuleConflict[] {
  const live = rulesInOrder(rules).filter((r) => r.deletedAt === null && r.enabled);
  const out: RuleConflict[] = [];

  const reserves = live.filter(
    (r): r is Extract<Rule, { type: 'constraint' }> & { config: { kind: 'reserve' } } =>
      r.type === 'constraint' && r.config.kind === 'reserve',
  );
  const cuts = live.filter(
    (r): r is Extract<Rule, { type: 'constraint' }> & { config: { kind: 'noHighEnergyAfter' } } =>
      r.type === 'constraint' && r.config.kind === 'noHighEnergyAfter',
  );

  // Two reservations on the same weekday that overlap in time.
  for (let i = 0; i < reserves.length; i += 1) {
    for (let j = i + 1; j < reserves.length; j += 1) {
      const a = reserves[i]!;
      const b = reserves[j]!;
      if (a.config.dayOfWeek !== b.config.dayOfWeek || !overlap(a.config, b.config)) continue;
      out.push({
        ruleIds: [a.id, b.id],
        message:
          `“${label(a)}” and “${label(b)}” both reserve ${WEEKDAY_NAME[a.config.dayOfWeek]} ` +
          `${formatMinute(Math.max(a.config.startMin, b.config.startMin))}–` +
          `${formatMinute(Math.min(a.config.endMin, b.config.endMin))}; the earlier rule wins.`,
      });
    }
  }

  // A window reserved for an area entirely after the high-energy cut can
  // never take that area's demanding work.
  for (const r of reserves) {
    if (r.config.areaId === null) continue;
    for (const cut of cuts) {
      if (r.config.startMin < cut.config.afterMin) continue;
      out.push({
        ruleIds: [r.id, cut.id],
        message:
          `“${label(r)}” reserves ${WEEKDAY_NAME[r.config.dayOfWeek]} ` +
          `${formatMinute(r.config.startMin)}–${formatMinute(r.config.endMin)} for one area, but ` +
          `“${label(cut)}” keeps demanding work out after ${formatMinute(cut.config.afterMin)}; ` +
          `only low- and medium-energy tasks from that area can land there.`,
      });
    }
  }

  // Only one rollover policy applies; a second is ignored.
  const rollovers = live.filter((r) => r.type === 'rollover');
  for (let i = 1; i < rollovers.length; i += 1) {
    out.push({
      ruleIds: [rollovers[0]!.id, rollovers[i]!.id],
      message: `Two rollover policies are enabled; only “${label(rollovers[0]!)}” applies.`,
    });
  }

  // Two recurring rules for the same routine ask for different counts.
  const recurring = live.filter(
    (r): r is Extract<Rule, { type: 'recurring' }> => r.type === 'recurring',
  );
  const byRoutine = new Map<Id, Extract<Rule, { type: 'recurring' }>>();
  for (const r of recurring) {
    const first = byRoutine.get(r.config.routineId);
    if (!first) {
      byRoutine.set(r.config.routineId, r);
      continue;
    }
    out.push({
      ruleIds: [first.id, r.id],
      message: `“${label(first)}” and “${label(r)}” both schedule the same routine; the first count wins.`,
    });
  }

  return out;
}

/** Conflict messages per rule id, for badges. */
export function conflictsByRule(conflicts: readonly RuleConflict[]): Map<Id, string[]> {
  const out = new Map<Id, string[]>();
  for (const c of conflicts) {
    for (const id of c.ruleIds) out.set(id, [...(out.get(id) ?? []), c.message]);
  }
  return out;
}
