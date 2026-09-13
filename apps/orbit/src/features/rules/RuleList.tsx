import { formatMinute } from '@orbit/core';
import type { Area, Id, Routine, Rule } from '@orbit/core';
import { AlertTriangle, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Checkbox';
import { Tooltip } from '@/components/ui/Popover';
import { RULE_TYPE_LABELS, WEEKDAY_OPTIONS } from './RuleForms';

interface Props {
  rules: readonly Rule[];
  conflicts: ReadonlyMap<Id, string[]>;
  areas: readonly Area[];
  routines: readonly Routine[];
  onToggle: (rule: Rule, enabled: boolean) => void;
  onEdit: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
}

const TARGET_LABEL = { tomorrow: 'tomorrow', nextWeek: 'next Monday', inbox: 'inbox' } as const;

/** One line that says what the rule does, in the user's terms. */
export function describeRule(
  rule: Rule,
  areas: readonly Area[] = [],
  routines: readonly Routine[] = [],
): string {
  switch (rule.type) {
    case 'constraint': {
      const c = rule.config;
      if (c.kind === 'noHighEnergyAfter')
        return `No demanding work after ${formatMinute(c.afterMin)}`;
      const day = WEEKDAY_OPTIONS.find((d) => d.value === c.dayOfWeek)?.label ?? c.dayOfWeek;
      const area = c.areaId ? areas.find((a) => a.id === c.areaId)?.name : null;
      return `${day} ${formatMinute(c.startMin)}–${formatMinute(c.endMin)} ${
        area ? `reserved for ${area}` : 'kept free'
      }${c.label ? ` (${c.label})` : ''}`;
    }
    case 'recurring': {
      const routine = routines.find((r) => r.id === rule.config.routineId)?.title ?? 'a routine';
      const n = rule.config.timesPerWeek;
      return `${routine} ${n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`} a week`;
    }
    case 'rollover':
      return `P1 → ${TARGET_LABEL[rule.config.p1]}, P2 → ${TARGET_LABEL[rule.config.p2]}, P3 → ${
        TARGET_LABEL[rule.config.p3]
      }`;
    case 'reminder':
      return rule.config.kind === 'billDueWithin'
        ? `Bills due within ${rule.config.days} day${rule.config.days === 1 ? '' : 's'}`
        : `Follow up after ${rule.config.days} day${rule.config.days === 1 ? '' : 's'} without a reply`;
  }
}

export function RuleList({ rules, conflicts, areas, routines, onToggle, onEdit, onDelete }: Props) {
  if (rules.length === 0) {
    return (
      <p className="text-[13px] text-ink-muted" data-testid="rules-empty">
        No rules yet. Add one below; the planner, the evening review, and reminders read them.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Rules">
      {rules.map((rule) => {
        const messages = conflicts.get(rule.id) ?? [];
        return (
          <li
            key={rule.id}
            data-testid={`rule-${rule.id}`}
            data-conflict={messages.length ? 'true' : undefined}
            className="rounded-md border border-line bg-surface px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={rule.enabled ? 'lime' : 'outline'}>{RULE_TYPE_LABELS[rule.type]}</Badge>
              <span className="min-w-0 flex-1 truncate text-sm">
                {rule.name ? <span className="font-medium">{rule.name} · </span> : null}
                {describeRule(rule, areas, routines)}
              </span>
              {messages.length ? (
                <Tooltip content={messages.join(' ')}>
                  <span
                    tabIndex={0}
                    className="inline-flex items-center gap-1 rounded-full bg-gold-2/60 px-2 py-0.5 text-[11px] font-medium text-gold-ink"
                    data-testid="conflict-badge"
                  >
                    <AlertTriangle className="size-3" aria-hidden="true" />
                    Conflict
                  </span>
                </Tooltip>
              ) : null}
              <Toggle
                aria-label={`${rule.enabled ? 'Disable' : 'Enable'} ${rule.name || describeRule(rule, areas, routines)}`}
                checked={rule.enabled}
                onCheckedChange={(v) => onToggle(rule, v)}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Edit ${rule.name || describeRule(rule, areas, routines)}`}
                onClick={() => onEdit(rule)}
              >
                <Pencil className="size-4" aria-hidden="true" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete ${rule.name || describeRule(rule, areas, routines)}`}
                onClick={() => onDelete(rule)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
            {messages.length ? (
              <ul
                className="mt-1 flex flex-col gap-0.5 text-[12px] text-gold-ink"
                aria-label="Conflicts"
              >
                {messages.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
