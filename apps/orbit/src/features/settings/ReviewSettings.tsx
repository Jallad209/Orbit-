import { newId, systemClock } from '@orbit/core';
import type { CaptureTemplate, Clock, ReviewQuestionId } from '@orbit/core';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader, Skeleton } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input, Label, Select } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { useRepository } from '@/platform';
import { readSettings, saveSettings } from './settingsService';

const LABEL: Record<ReviewQuestionId, string> = {
  project: 'Projects',
  bill: 'Bills',
  person: 'People',
};

export function ReviewSettings({ clock = systemClock }: { clock?: Clock }) {
  const { data } = useRepoQuery((r) => readSettings(r, clock), [clock]);
  if (!data) return <Skeleton className="h-56" />;
  return <ReviewSettingsForm key={data.updatedAt} initial={data.reviews} clock={clock} />;
}

function ReviewSettingsForm({
  initial,
  clock,
}: {
  initial: {
    questionOrder: ReviewQuestionId[];
    enabledQuestions: ReviewQuestionId[];
    templates: CaptureTemplate[];
  };
  clock: Clock;
}) {
  const repo = useRepository();
  const [order, setOrder] = useState(initial.questionOrder);
  const [enabled, setEnabled] = useState(initial.enabledQuestions);
  const [templates, setTemplates] = useState(initial.templates);
  const [kind, setKind] = useState<ReviewQuestionId>('project');
  const [name, setName] = useState('');
  const [primary, setPrimary] = useState('');
  const [busy, setBusy] = useState(false);
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setOrder(next);
  };
  const save = async (nextTemplates = templates) => {
    setBusy(true);
    try {
      await saveSettings(
        repo,
        { reviews: { questionOrder: order, enabledQuestions: enabled, templates: nextTemplates } },
        clock,
      );
      toast({ title: 'Morning settings saved', variant: 'success' });
    } finally {
      setBusy(false);
    }
  };
  const addTemplate = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !primary.trim() || templates.length >= 20) return;
    const values: Record<string, string> =
      kind === 'person' ? { name: primary.trim() } : { title: primary.trim() };
    const next = [...templates, { id: newId(), kind, name: name.trim(), values }];
    setTemplates(next);
    setName('');
    setPrimary('');
    await save(next);
  };
  return (
    <Card data-testid="review-settings">
      <SectionHeader title="Morning briefing" meta="Desktop · stored locally" />
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[13px] font-medium text-ink">Questions</p>
          <p className="text-[12px] text-ink-faint">
            Reorder or hide capture questions. Energy, At risk, Plan, and Accept always stay in the
            flow.
          </p>
          <ol className="mt-2 flex flex-col gap-2">
            {order.map((id, index) => (
              <li
                key={id}
                className="flex items-center gap-2 rounded-md border border-line px-3 py-2"
              >
                <Checkbox
                  checked={enabled.includes(id)}
                  onCheckedChange={(checked) =>
                    setEnabled((items) =>
                      checked ? [...new Set([...items, id])] : items.filter((item) => item !== id),
                    )
                  }
                  label={LABEL[id]}
                />
                <span className="flex-1" />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Move ${LABEL[id]} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Move ${LABEL[id]} down`}
                  disabled={index === order.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="size-4" />
                </Button>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save question order
          </Button>
        </div>
        <div className="border-t border-line pt-4">
          <p className="text-[13px] font-medium text-ink">
            Capture templates · {templates.length}/20
          </p>
          <p className="text-[12px] text-ink-faint">
            Templates prefill the main name. You can complete dates, amounts, and details during the
            briefing.
          </p>
          {templates.length ? (
            <ul className="mt-2 flex flex-col gap-1">
              {templates.map((template) => (
                <li key={template.id} className="flex items-center gap-2 text-sm">
                  <span className="w-20 text-ink-faint">{LABEL[template.kind]}</span>
                  <span className="flex-1">{template.name}</span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${template.name}`}
                    onClick={() => {
                      const next = templates.filter((item) => item.id !== template.id);
                      setTemplates(next);
                      void save(next);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <form
            className="mt-3 grid items-end gap-2 md:grid-cols-[8rem_1fr_1fr_auto]"
            onSubmit={addTemplate}
          >
            <div>
              <Label htmlFor="template-kind">Type</Label>
              <Select
                id="template-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as ReviewQuestionId)}
              >
                {order.map((id) => (
                  <option key={id} value={id}>
                    {LABEL[id]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="template-name">Template name</Label>
              <Input
                id="template-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Monthly rent"
              />
            </div>
            <div>
              <Label htmlFor="template-primary">Prefilled name</Label>
              <Input
                id="template-primary"
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
                placeholder={
                  kind === 'person' ? 'Person name' : kind === 'bill' ? 'Bill name' : 'Project name'
                }
              />
            </div>
            <Button
              type="submit"
              disabled={!name.trim() || !primary.trim() || templates.length >= 20}
            >
              <Plus className="size-4" />
              Add
            </Button>
          </form>
        </div>
      </div>
    </Card>
  );
}
