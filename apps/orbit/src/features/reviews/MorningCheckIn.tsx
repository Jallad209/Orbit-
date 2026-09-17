import type { CaptureTemplate, Clock, ReviewQuestionId, ReviewRef } from '@orbit/core';
import { CheckCircle2 } from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Label, Select } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { createBill } from '@/features/bills/billsService';
import { createPerson } from '@/features/people/peopleService';
import { createArea, createProject } from '@/features/structure/structureService';
import { useRepository } from '@/platform';
import type { MorningData } from './reviewService';

export type CheckInAnswer = 'yes' | 'no' | 'later' | null;
export interface CheckInFormState {
  answer: CheckInAnswer;
  laterTime: string;
  savedLabel: string;
  [key: string]: unknown;
}

export const EMPTY_CHECK_INS: Record<ReviewQuestionId, CheckInFormState> = {
  project: {
    answer: null,
    laterTime: '15:00',
    savedLabel: '',
    title: '',
    areaId: '',
    areaName: '',
    deadline: '',
  },
  bill: {
    answer: null,
    laterTime: '15:00',
    savedLabel: '',
    title: '',
    amount: '',
    currency: '',
    dueDate: '',
    dueTime: '',
  },
  person: {
    answer: null,
    laterTime: '15:00',
    savedLabel: '',
    name: '',
    contact: '',
    followUpDate: '',
    followUpTime: '',
  },
};

function minutes(time: string): number | null {
  if (!time) return null;
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return hour * 60 + minute;
}

function field(state: CheckInFormState, key: string): string {
  return typeof state[key] === 'string' ? (state[key] as string) : '';
}

function Templates({
  kind,
  templates,
  onApply,
}: {
  kind: ReviewQuestionId;
  templates: CaptureTemplate[];
  onApply: (values: Record<string, string>) => void;
}) {
  const options = templates.filter((template) => template.kind === kind);
  if (!options.length) return null;
  return (
    <div className="max-w-xs">
      <Label htmlFor={`template-${kind}`}>Use template</Label>
      <Select
        id={`template-${kind}`}
        value=""
        onChange={(event) => {
          const template = options.find((item) => item.id === event.target.value);
          if (template) onApply(template.values);
        }}
      >
        <option value="">Choose a template…</option>
        {options.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

function QuestionCard({
  kind,
  question,
  hint,
  state,
  onChange,
  onScheduleLater,
  children,
}: {
  kind: ReviewQuestionId;
  question: string;
  hint: string;
  state: CheckInFormState;
  onChange: (patch: Partial<CheckInFormState>) => void;
  onScheduleLater: () => void;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <p className="text-h1 font-semibold tracking-tight text-ink">{question}</p>
        <p className="mt-1 text-sm text-ink-muted">{hint}</p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={question}>
        <Button
          variant={state.answer === 'yes' ? 'primary' : 'secondary'}
          aria-pressed={state.answer === 'yes'}
          onClick={() => onChange({ answer: 'yes', savedLabel: '' })}
        >
          Yes, add one
        </Button>
        <Button
          variant={state.answer === 'no' ? 'primary' : 'secondary'}
          aria-pressed={state.answer === 'no'}
          onClick={() => onChange({ answer: 'no' })}
        >
          No, continue
        </Button>
        <Button
          variant={state.answer === 'later' ? 'primary' : 'secondary'}
          aria-pressed={state.answer === 'later'}
          onClick={() => onChange({ answer: 'later' })}
        >
          Later today
        </Button>
      </div>
      {state.answer === 'later' ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-line bg-surface-2 p-3">
          <div>
            <Label htmlFor={`later-${kind}`}>Remind me at</Label>
            <Input
              id={`later-${kind}`}
              type="time"
              value={state.laterTime}
              onChange={(event) => onChange({ laterTime: event.target.value })}
              className="mt-1 w-32"
            />
          </div>
          <Button variant="primary" disabled={!state.laterTime} onClick={onScheduleLater}>
            Schedule and continue
          </Button>
          <p className="w-full text-[12px] text-ink-faint">
            Stored on this device. The reminder returns to this exact question.
          </p>
        </div>
      ) : null}
      {state.answer === 'yes' ? children : null}
      {state.answer === 'no' ? (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <CheckCircle2 className="size-4 text-lime-ink" aria-hidden="true" />
          Nothing to add here. Continue when you’re ready.
        </p>
      ) : null}
      {state.answer === 'later' && state.savedLabel === 'scheduled' ? (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <CheckCircle2 className="size-4 text-lime-ink" aria-hidden="true" />
          Reminder scheduled. You can continue.
        </p>
      ) : null}
    </Card>
  );
}

function Saved({ label, onAnother }: { label: string; onAnother: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-lime/40 bg-lime/10 px-3 py-2">
      <p className="flex items-center gap-2 text-sm text-ink">
        <CheckCircle2 className="size-4 text-lime-ink" aria-hidden="true" />
        {label}
      </p>
      <Button size="sm" variant="ghost" onClick={onAnother}>
        Add another
      </Button>
    </div>
  );
}

interface CommonProps {
  clock: Clock;
  state: CheckInFormState;
  onChange: (patch: Partial<CheckInFormState>) => void;
  onReady: (ready: boolean) => void;
  onCreated: (ref: ReviewRef) => void;
  onLater: () => void;
  templates: CaptureTemplate[];
}

export function ProjectCheckIn({
  data,
  clock,
  state,
  onChange,
  onReady,
  onCreated,
  onLater,
  templates,
}: CommonProps & { data: MorningData }) {
  const repo = useRepository();
  const [busy, setBusy] = useState(false);
  const areas = useMemo(
    () => [...data.areaById.values()].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const title = field(state, 'title').trim();
    let areaId = field(state, 'areaId') || areas[0]?.id || '';
    const areaName = field(state, 'areaName').trim();
    if (!title || (!areaId && !areaName)) return;
    setBusy(true);
    try {
      if (!areaId) areaId = (await createArea(repo, { name: areaName }, clock)).id;
      const project = await createProject(
        repo,
        { title, areaId, deadline: field(state, 'deadline') || null },
        clock,
      );
      onChange({ savedLabel: project.title, title: '', deadline: '', areaId });
      onReady(true);
      onCreated({ type: 'project', id: project.id });
      toast({ title: 'Project added', description: project.title, variant: 'success' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <QuestionCard
      kind="project"
      question="Do you have a new project?"
      hint="Capture the outcome now. A target date is optional; projects never ask for a time."
      state={state}
      onChange={(patch) => {
        onChange(patch);
        onReady(patch.answer === 'no');
      }}
      onScheduleLater={onLater}
    >
      {state.savedLabel ? (
        <Saved
          label={`“${state.savedLabel}” was added.`}
          onAnother={() => {
            onChange({ savedLabel: '' });
            onReady(false);
          }}
        />
      ) : (
        <form
          className="grid items-end gap-3 md:grid-cols-2"
          onSubmit={submit}
          aria-label="New morning project"
        >
          <Templates
            kind="project"
            templates={templates}
            onApply={(values) => onChange({ ...values })}
          />
          <div className="md:col-span-2">
            <Label htmlFor="morning-project-title">Project name</Label>
            <Input
              id="morning-project-title"
              value={field(state, 'title')}
              onChange={(e) => onChange({ title: e.target.value })}
              placeholder="Launch the portfolio"
              autoFocus
            />
          </div>
          {areas.length ? (
            <div>
              <Label htmlFor="morning-project-area">Area</Label>
              <Select
                id="morning-project-area"
                value={field(state, 'areaId') || areas[0]?.id || ''}
                onChange={(e) => onChange({ areaId: e.target.value })}
              >
                {areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <div>
              <Label htmlFor="morning-project-area-name">Area</Label>
              <Input
                id="morning-project-area-name"
                value={field(state, 'areaName')}
                onChange={(e) => onChange({ areaName: e.target.value })}
                placeholder="Work, health, learning…"
              />
            </div>
          )}
          <div>
            <Label htmlFor="morning-project-date" hint="optional">
              Target date
            </Label>
            <Input
              id="morning-project-date"
              type="date"
              value={field(state, 'deadline')}
              onChange={(e) => onChange({ deadline: e.target.value })}
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={
              !field(state, 'title').trim() ||
              (!field(state, 'areaId') && !areas[0] && !field(state, 'areaName').trim())
            }
            className="md:col-span-2 md:justify-self-end"
          >
            Add project
          </Button>
        </form>
      )}
    </QuestionCard>
  );
}

export function BillCheckIn({
  clock,
  state,
  onChange,
  onReady,
  onCreated,
  onLater,
  templates,
}: CommonProps) {
  const repo = useRepository();
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const title = field(state, 'title').trim();
    if (!title) return;
    setBusy(true);
    try {
      const bill = await createBill(
        repo,
        {
          title,
          amount: field(state, 'amount') ? Number(field(state, 'amount')) : 0,
          currency: field(state, 'currency').trim().toUpperCase(),
          dueAt: field(state, 'dueDate') || null,
          dueTime: minutes(field(state, 'dueTime')),
          recurrence: null,
        },
        clock,
      );
      onChange({ savedLabel: bill.title, title: '', amount: '', dueDate: '', dueTime: '' });
      onReady(true);
      onCreated({ type: 'bill', id: bill.id });
      toast({ title: 'Bill added', description: bill.title, variant: 'success' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <QuestionCard
      kind="bill"
      question="Any new bills to remember?"
      hint="Only the name is required. Amount, currency, date, and time are optional."
      state={state}
      onChange={(patch) => {
        onChange(patch);
        onReady(patch.answer === 'no');
      }}
      onScheduleLater={onLater}
    >
      {state.savedLabel ? (
        <Saved
          label={`“${state.savedLabel}” was added.`}
          onAnother={() => {
            onChange({ savedLabel: '' });
            onReady(false);
          }}
        />
      ) : (
        <form
          className="grid items-end gap-3 md:grid-cols-2"
          onSubmit={submit}
          aria-label="New morning bill"
        >
          <Templates
            kind="bill"
            templates={templates}
            onApply={(values) => onChange({ ...values })}
          />
          <div className="md:col-span-2">
            <Label htmlFor="morning-bill-title">Bill name</Label>
            <Input
              id="morning-bill-title"
              value={field(state, 'title')}
              onChange={(e) => onChange({ title: e.target.value })}
              placeholder="Electricity"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="morning-bill-amount" hint="optional">
              Amount
            </Label>
            <Input
              id="morning-bill-amount"
              type="number"
              min="0"
              step="0.01"
              value={field(state, 'amount')}
              onChange={(e) => onChange({ amount: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="morning-bill-currency" hint="optional">
              Currency
            </Label>
            <Input
              id="morning-bill-currency"
              value={field(state, 'currency')}
              onChange={(e) => onChange({ currency: e.target.value })}
              placeholder="JOD"
              maxLength={8}
            />
          </div>
          <div>
            <Label htmlFor="morning-bill-date" hint="optional">
              Due date
            </Label>
            <Input
              id="morning-bill-date"
              type="date"
              value={field(state, 'dueDate')}
              onChange={(e) =>
                onChange({ dueDate: e.target.value, ...(!e.target.value ? { dueTime: '' } : {}) })
              }
            />
          </div>
          <div>
            <Label htmlFor="morning-bill-time" hint="optional">
              Due time
            </Label>
            <Input
              id="morning-bill-time"
              type="time"
              value={field(state, 'dueTime')}
              onChange={(e) => onChange({ dueTime: e.target.value })}
              disabled={!field(state, 'dueDate')}
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={!field(state, 'title').trim()}
            className="md:col-span-2 md:justify-self-end"
          >
            Add bill
          </Button>
        </form>
      )}
    </QuestionCard>
  );
}

export function PeopleCheckIn({
  clock,
  state,
  onChange,
  onReady,
  onCreated,
  onLater,
  templates,
}: CommonProps) {
  const repo = useRepository();
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = field(state, 'name').trim();
    if (!name) return;
    setBusy(true);
    try {
      const person = await createPerson(
        repo,
        {
          name,
          contact: field(state, 'contact').trim(),
          followUpDate: field(state, 'followUpDate') || null,
          followUpTime: minutes(field(state, 'followUpTime')),
        },
        clock,
      );
      onChange({
        savedLabel: person.name,
        name: '',
        contact: '',
        followUpDate: '',
        followUpTime: '',
      });
      onReady(true);
      onCreated({ type: 'person', id: person.id });
      toast({ title: 'Person added', description: person.name, variant: 'success' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <QuestionCard
      kind="person"
      question="Anyone new to remember?"
      hint="Only a name is required. Contact details, follow-up date, and time are optional."
      state={state}
      onChange={(patch) => {
        onChange(patch);
        onReady(patch.answer === 'no');
      }}
      onScheduleLater={onLater}
    >
      {state.savedLabel ? (
        <Saved
          label={`“${state.savedLabel}” was added.`}
          onAnother={() => {
            onChange({ savedLabel: '' });
            onReady(false);
          }}
        />
      ) : (
        <form
          className="grid items-end gap-3 md:grid-cols-2"
          onSubmit={submit}
          aria-label="New morning person"
        >
          <Templates
            kind="person"
            templates={templates}
            onApply={(values) => onChange({ ...values })}
          />
          <div>
            <Label htmlFor="morning-person-name">Name</Label>
            <Input
              id="morning-person-name"
              value={field(state, 'name')}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="Omar"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="morning-person-contact" hint="optional">
              Contact
            </Label>
            <Input
              id="morning-person-contact"
              value={field(state, 'contact')}
              onChange={(e) => onChange({ contact: e.target.value })}
              placeholder="Email, phone, or handle"
            />
          </div>
          <div>
            <Label htmlFor="morning-person-date" hint="optional">
              Follow-up date
            </Label>
            <Input
              id="morning-person-date"
              type="date"
              value={field(state, 'followUpDate')}
              onChange={(e) =>
                onChange({
                  followUpDate: e.target.value,
                  ...(!e.target.value ? { followUpTime: '' } : {}),
                })
              }
            />
          </div>
          <div>
            <Label htmlFor="morning-person-time" hint="optional">
              Follow-up time
            </Label>
            <Input
              id="morning-person-time"
              type="time"
              value={field(state, 'followUpTime')}
              onChange={(e) => onChange({ followUpTime: e.target.value })}
              disabled={!field(state, 'followUpDate')}
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={!field(state, 'name').trim()}
            className="md:col-span-2 md:justify-self-end"
          >
            Add person
          </Button>
        </form>
      )}
    </QuestionCard>
  );
}
