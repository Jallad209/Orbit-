import { systemClock } from '@orbit/core';
import type { Clock, Rule, RuleType } from '@orbit/core';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { useRepository } from '@/platform';
import { RULE_TYPE_LABELS, RuleForm } from './RuleForms';
import { RuleList } from './RuleList';
import { deleteRule, loadRules, saveRule, setRuleEnabled } from './ruleService';

const FAMILIES: RuleType[] = ['constraint', 'recurring', 'rollover', 'reminder'];

interface Props {
  clock?: Clock;
}

/** Settings → Rules: the list with its conflict badges, and one editor at a time. */
export function RulesSection({ clock = systemClock }: Props) {
  const repo = useRepository();
  const { data } = useRepoQuery(loadRules, []);
  const [editor, setEditor] = useState<{ type: RuleType; rule: Rule | null } | null>(null);

  const submit = async (rule: Rule) => {
    await saveRule(repo, rule);
    toast({ title: editor?.rule ? 'Rule saved' : 'Rule added', variant: 'success' });
    setEditor(null);
  };

  return (
    <Card data-testid="rules-section">
      <SectionHeader
        title="Rules"
        meta={data ? `${data.rules.filter((r) => r.enabled).length} active` : undefined}
      />
      <p className="mb-3 text-[13px] text-ink-muted">
        Structured rules, not sentences. Constraints shape the plan, recurring rules schedule
        routines, the rollover policy steers the evening review, reminders queue notifications.
      </p>
      {data ? (
        <RuleList
          rules={data.rules}
          conflicts={data.conflictsByRule}
          areas={data.areas}
          routines={data.routines}
          onToggle={(rule, enabled) => void setRuleEnabled(repo, rule, enabled)}
          onEdit={(rule) => setEditor({ type: rule.type, rule })}
          onDelete={async (rule) => {
            await deleteRule(repo, rule.id);
            toast('Rule deleted');
          }}
        />
      ) : null}
      {editor ? (
        <div
          className="mt-4 rounded-md border border-line bg-surface p-4"
          data-testid="rule-editor"
        >
          <p className="mb-3 text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
            {editor.rule ? 'Edit' : 'New'} {RULE_TYPE_LABELS[editor.type].toLowerCase()}
          </p>
          <RuleForm
            key={editor.rule?.id ?? editor.type}
            type={editor.type}
            rule={editor.rule}
            areas={data?.areas ?? []}
            routines={data?.routines ?? []}
            onSubmit={submit}
            onCancel={() => setEditor(null)}
            clock={clock}
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Add a rule">
          {FAMILIES.map((type) => (
            <Button
              key={type}
              size="sm"
              variant="secondary"
              onClick={() => setEditor({ type, rule: null })}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              {RULE_TYPE_LABELS[type]}
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}
