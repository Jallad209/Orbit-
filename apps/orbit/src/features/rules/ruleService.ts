import { conflictsByRule, detectConflicts } from '@orbit/core';
import type { Area, Id, Routine, Rule, RuleConflict } from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { bumpData } from '@/data/useQuery';

export interface RulesData {
  rules: Rule[];
  conflicts: RuleConflict[];
  /** Conflict messages per rule id, for the badges. */
  conflictsByRule: Map<Id, string[]>;
  areas: Area[];
  routines: Routine[];
}

export async function loadRules(repo: Repository): Promise<RulesData> {
  const [rules, areas, routines] = await Promise.all([
    repo.rules.list(),
    repo.areas.list(),
    repo.routines.list(),
  ]);
  const conflicts = detectConflicts(rules);
  return {
    rules: rules.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    conflicts,
    conflictsByRule: conflictsByRule(conflicts),
    areas: areas.sort((a, b) => a.name.localeCompare(b.name)),
    routines: routines.sort((a, b) => a.title.localeCompare(b.title)),
  };
}

/** Store a rule the form already validated through `RuleSchema`. */
export async function saveRule(repo: Repository, rule: Rule): Promise<Rule> {
  const stored = await repo.rules.upsert(rule);
  bumpData();
  return stored;
}

export async function setRuleEnabled(
  repo: Repository,
  rule: Rule,
  enabled: boolean,
): Promise<Rule> {
  const stored = await repo.rules.upsert({ ...rule, enabled });
  bumpData();
  return stored;
}

export async function deleteRule(repo: Repository, ruleId: Id): Promise<void> {
  await repo.rules.softDelete(ruleId);
  bumpData();
}
