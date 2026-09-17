import type { Clock, Id, LocalDate, RolloverTarget, Task } from '@orbit/core';
import {
  formatDuration,
  fromLocalDate,
  parseDuration,
  rolloverDate,
  systemClock,
  toLocalDate,
} from '@orbit/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Repository } from '@orbit/storage';
import { useNavigate, useSearchParams } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, ProgressBar, Skeleton } from '@/components/ui/Card';
import { FieldError, Input, Label, Textarea } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { cn } from '@/lib/cn';
import { useRepository } from '@/platform';
import { loadEvening, submitEvening, type EveningData } from './reviewService';
import {
  loadDailyReflectionDraft,
  saveDailyReflection,
  type ReflectionInput,
} from './dailyReviewService';
import { FlowShell } from './Stepper';

const STEPS = ['Committed', 'Actuals', 'Rollover', 'Journal', 'Summary'] as const;
const TARGETS: Array<{ value: RolloverTarget; label: string }> = [
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'nextWeek', label: 'Next week' },
  { value: 'inbox', label: 'Inbox' },
];

interface Props {
  clock?: Clock;
}

/**
 * The evening shutdown: what was committed against what got done, actual
 * durations for tasks finished without a timer, a rollover choice per
 * unfinished task, and where the day's time went. One transaction at the end.
 */
export function EveningFlow({ clock = systemClock }: Props) {
  const repo = useRepository();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const today = toLocalDate(clock.now());
  const date: LocalDate = params.get('date') ?? today;
  const [step, setStep] = useState(0);
  const [actuals, setActuals] = useState<Record<Id, string>>({});
  const [errors, setErrors] = useState<Record<Id, string>>({});
  const [choices, setChoices] = useState<Record<Id, RolloverTarget>>({});
  const [reflection, setReflection] = useState<ReflectionInput>({
    body: '',
    promptId: null,
    mood: null,
    stress: null,
    sleepQuality: null,
    tags: [],
  });
  const reflectionHydrated = useRef(false);
  const [busy, setBusy] = useState(false);

  const query = useCallback((r: Repository) => loadEvening(r, date, clock), [date, clock]);
  const { data } = useRepoQuery(query, [query]);
  const reflectionQuery = useCallback((r: Repository) => loadDailyReflectionDraft(r, date), [date]);
  const { data: savedReflection } = useRepoQuery(reflectionQuery, [reflectionQuery]);
  useEffect(() => {
    if (!savedReflection || reflectionHydrated.current) return;
    reflectionHydrated.current = true;
    setReflection(savedReflection);
  }, [savedReflection]);

  // State holds only what the user changed; defaults come from the data:
  // the estimate for actuals, the rollover rule's suggestion for targets.
  const actualText = (t: Task) => actuals[t.id] ?? formatDuration(t.estimateMin);
  const suggestionFor = (id: Id): RolloverTarget =>
    data?.rollover.find((r) => r.task.id === id)?.suggestion ?? 'tomorrow';
  const choiceFor = (id: Id): RolloverTarget => choices[id] ?? suggestionFor(id);

  const parsedActuals = () => {
    if (!data) return null;
    const out: Array<{ taskId: Id; actualMin: number }> = [];
    const errs: Record<Id, string> = {};
    for (const t of data.needsActual) {
      const text = actualText(t);
      if (!text.trim()) continue; // left blank: the user does not know; ask no more
      const minutes = parseDuration(text);
      if (minutes === null) errs[t.id] = 'Enter minutes like 25, 1h, or 1h30.';
      else out.push({ taskId: t.id, actualMin: minutes });
    }
    setErrors(errs);
    return Object.keys(errs).length ? null : out;
  };

  const finish = async () => {
    if (!data) return;
    const parsed = parsedActuals();
    if (!parsed) {
      setStep(1);
      return;
    }
    setBusy(true);
    try {
      await saveDailyReflection(
        repo,
        date,
        { ...reflection, promptId: reflection.promptId ?? journalPromptFor(date).id },
        clock,
      );
      const result = await submitEvening(
        repo,
        {
          actuals: parsed,
          rollover: data.unfinished.map((t) => ({ taskId: t.id, target: choiceFor(t.id) })),
        },
        clock,
      );
      toast({
        title: 'Day closed',
        description: `${data.done.length} done · ${result.rolled.length} rolled over`,
        variant: 'success',
      });
      navigate('/today');
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (step === 1 && !parsedActuals()) return;
    if (step === STEPS.length - 1) void finish();
    else setStep((s) => s + 1);
  };

  return (
    <FlowShell
      testId="evening-flow"
      title="Evening shutdown"
      subtitle={date === today ? 'Today' : date}
      steps={STEPS}
      current={step}
      onSelect={setStep}
      onBack={() => setStep((s) => Math.max(0, s - 1))}
      onNext={next}
      finishLabel="Close the day"
      nextDisabled={!data}
      busy={busy}
    >
      {!data ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-12" />
          <Skeleton className="h-40" />
        </div>
      ) : step === 0 ? (
        <CommittedStep data={data} />
      ) : step === 1 ? (
        <ActualsStep
          tasks={data.needsActual}
          valueFor={actualText}
          errors={errors}
          onChange={(id, text) => {
            setActuals((a) => ({ ...a, [id]: text }));
            setErrors((e) => {
              if (!(id in e)) return e;
              const rest = { ...e };
              delete rest[id];
              return rest;
            });
          }}
        />
      ) : step === 2 ? (
        <RolloverStep
          data={data}
          today={today}
          choiceFor={choiceFor}
          onChoose={(id, target) => setChoices((c) => ({ ...c, [id]: target }))}
        />
      ) : step === 3 ? (
        <JournalStep
          value={reflection}
          onChange={(patch) => setReflection((current) => ({ ...current, ...patch }))}
          date={date}
        />
      ) : (
        <SummaryStep data={data} choiceFor={choiceFor} />
      )}
    </FlowShell>
  );
}

const JOURNAL_PROMPTS = [
  { id: 'win', text: 'What felt meaningful or went better than expected?' },
  { id: 'lesson', text: 'What did today teach you?' },
  { id: 'unfinished', text: 'What are you ready to leave here instead of carrying forward?' },
  { id: 'gratitude', text: 'What small moment do you want to remember?' },
] as const;

export function journalPromptFor(date: LocalDate) {
  const seed = [...date].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return JOURNAL_PROMPTS[seed % JOURNAL_PROMPTS.length]!;
}

function JournalStep({
  value,
  onChange,
  date,
}: {
  value: ReflectionInput;
  onChange: (patch: Partial<ReflectionInput>) => void;
  date: LocalDate;
}) {
  const suggested = journalPromptFor(date);
  const selected = value.promptId ?? suggested.id;
  return (
    <Card data-testid="evening-journal" className="flex flex-col gap-4">
      <Label htmlFor="daily-journal" hint="optional">
        Write about your day
      </Label>
      <p className="mt-1 text-sm text-ink-muted">
        What happened, what mattered, and what do you want to remember? This saves as a daily note
        for {date}.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Journal prompt">
        <Button
          size="sm"
          variant={selected === suggested.id ? 'primary' : 'secondary'}
          onClick={() => onChange({ promptId: suggested.id })}
        >
          Today’s prompt
        </Button>
        <Button
          size="sm"
          variant={selected === 'free-write' ? 'primary' : 'secondary'}
          onClick={() => onChange({ promptId: 'free-write' })}
        >
          Free write
        </Button>
      </div>
      <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-ink">
        {selected === 'free-write' ? 'Write whatever you want to keep from today.' : suggested.text}
      </p>
      <Textarea
        id="daily-journal"
        value={value.body}
        onChange={(event) => onChange({ body: event.target.value })}
        placeholder="Today I…"
        rows={8}
        className="mt-3 resize-y"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Rating label="Mood" value={value.mood} onChange={(mood) => onChange({ mood })} />
        <Rating label="Stress" value={value.stress} onChange={(stress) => onChange({ stress })} />
        <Rating
          label="Sleep quality"
          value={value.sleepQuality}
          onChange={(sleepQuality) => onChange({ sleepQuality })}
        />
      </div>
      <div>
        <Label htmlFor="reflection-tags" hint="optional, comma separated">
          Tags
        </Label>
        <Input
          id="reflection-tags"
          value={value.tags.join(', ')}
          onChange={(event) =>
            onChange({
              tags: event.target.value
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean)
                .slice(0, 12),
            })
          }
          placeholder="focused, family, low energy"
        />
      </div>
      <p className="text-[12px] text-ink-faint">
        Everything stays on this device. Orbit uses only the ratings and tags for patterns; it never
        analyzes this prose.
      </p>
    </Card>
  );
}

function Rating({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[13px] font-medium text-ink">
        {label} <span className="font-normal text-ink-faint">optional</span>
      </p>
      <div className="flex gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            key={rating}
            type="button"
            role="radio"
            aria-checked={value === rating}
            onClick={() => onChange(value === rating ? null : rating)}
            className={cn(
              'grid size-8 place-items-center rounded-md border text-[13px]',
              value === rating
                ? 'border-lime-ink bg-lime text-lime-ink'
                : 'border-line text-ink-muted hover:bg-surface-2',
            )}
          >
            {rating}
          </button>
        ))}
      </div>
    </div>
  );
}

function CommittedStep({ data }: { data: EveningData }) {
  if (!data.commitment) {
    return (
      <Card>
        <p className="text-sm text-ink-muted" data-testid="evening-no-commitment">
          No plan was accepted for this day. You can still record actuals and close it.
        </p>
      </Card>
    );
  }
  const doneIds = new Set(data.done.map((t) => t.id));
  return (
    <Card data-testid="evening-committed">
      <p className="mb-2 text-sm text-ink">
        <strong>{data.done.length}</strong> of <strong>{data.committed.length}</strong> committed
        tasks done
      </p>
      <ProgressBar
        value={data.committed.length ? data.done.length / data.committed.length : 0}
        label="Commitment progress"
        className="mb-3"
      />
      <ul className="flex flex-col gap-1 text-sm" aria-label="Committed tasks">
        {data.committed.map((t) => (
          <li key={t.id} className="flex items-center gap-2" data-testid={`committed-${t.id}`}>
            <Badge tone={doneIds.has(t.id) ? 'lime' : t.status === 'archived' ? 'outline' : 'gold'}>
              {doneIds.has(t.id) ? 'Done' : t.status === 'archived' ? 'Archived' : 'Unfinished'}
            </Badge>
            <span className={cn('min-w-0 flex-1 truncate', doneIds.has(t.id) && 'text-ink-muted')}>
              {t.title}
            </span>
            {t.actualMin !== null ? (
              <span className="text-[12px] text-ink-faint tnum">{formatDuration(t.actualMin)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ActualsStep({
  tasks,
  valueFor,
  errors,
  onChange,
}: {
  tasks: Task[];
  valueFor: (task: Task) => string;
  errors: Record<Id, string>;
  onChange: (id: Id, text: string) => void;
}) {
  if (tasks.length === 0) {
    return (
      <Card>
        <p className="text-sm text-ink-muted" data-testid="evening-no-actuals">
          Every task completed today has a duration. Nothing to fill in.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <p className="mb-3 text-sm text-ink-muted">
        These were completed without a timer. How long did each take? Leave one blank to skip it.
      </p>
      <ul className="flex flex-col gap-3" aria-label="Actuals">
        {tasks.map((t) => {
          const id = `actual-${t.id}`;
          return (
            <li key={t.id} className="grid gap-1 sm:grid-cols-[1fr_10rem] sm:items-center">
              <Label htmlFor={id} hint={`estimated ${formatDuration(t.estimateMin)}`}>
                {t.title}
              </Label>
              <div>
                <Input
                  id={id}
                  value={valueFor(t)}
                  onChange={(e) => onChange(t.id, e.target.value)}
                  invalid={!!errors[t.id]}
                  aria-describedby={errors[t.id] ? `${id}-error` : undefined}
                  placeholder="25, 1h, 1h30"
                />
                <FieldError id={`${id}-error`}>{errors[t.id]}</FieldError>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function landsOn(target: RolloverTarget, today: LocalDate): string {
  const d = rolloverDate(target, today);
  if (!d) return 'back to triage';
  return fromLocalDate(d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function RolloverStep({
  data,
  today,
  choiceFor,
  onChoose,
}: {
  data: EveningData;
  today: LocalDate;
  choiceFor: (id: Id) => RolloverTarget;
  onChoose: (id: Id, target: RolloverTarget) => void;
}) {
  if (data.unfinished.length === 0) {
    return (
      <Card>
        <p className="text-sm text-ink-muted" data-testid="evening-nothing-unfinished">
          Everything committed got done. Nothing to roll over.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <p className="mb-3 text-sm text-ink-muted">
        Unfinished committed work. The suggestion follows your rollover rule by priority.
      </p>
      <ul className="flex flex-col gap-3" aria-label="Unfinished tasks">
        {data.rollover.map(({ task }) => {
          const chosen = choiceFor(task.id);
          return (
            <li
              key={task.id}
              className="flex flex-wrap items-center gap-3"
              data-testid={`rollover-${task.id}`}
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                {task.title}
                <span className="ml-2 text-[12px] text-ink-faint">P{task.priority}</span>
              </span>
              <div
                role="radiogroup"
                aria-label={`Roll over ${task.title}`}
                className="flex rounded-md border border-line"
              >
                {TARGETS.map((t, i) => (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={chosen === t.value}
                    onClick={() => onChoose(task.id, t.value)}
                    className={cn(
                      'h-8 px-3 text-[13px]',
                      i === 0 ? 'rounded-l-md' : i === TARGETS.length - 1 ? 'rounded-r-md' : '',
                      chosen === t.value
                        ? 'bg-nav text-nav-fg'
                        : 'text-ink-muted hover:bg-surface-2',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <span className="w-28 text-[12px] text-ink-faint tnum">{landsOn(chosen, today)}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function SummaryStep({
  data,
  choiceFor,
}: {
  data: EveningData;
  choiceFor: (id: Id) => RolloverTarget;
}) {
  const max = Math.max(1, ...data.timeByArea.map((x) => x.minutes));
  const total = data.timeByArea.reduce((m, x) => m + x.minutes, 0);
  const counts = { tomorrow: 0, nextWeek: 0, inbox: 0 };
  for (const t of data.unfinished) counts[choiceFor(t.id)] += 1;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card data-testid="evening-summary">
        <p className="mb-2 text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
          The day
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            <strong>{data.done.length}</strong> of {data.committed.length} committed tasks done
          </li>
          <li>
            <strong>{data.needsActual.length}</strong> actual
            {data.needsActual.length === 1 ? '' : 's'} recorded
          </li>
          <li>
            <strong>{counts.tomorrow}</strong> to tomorrow · <strong>{counts.nextWeek}</strong> to
            next week · <strong>{counts.inbox}</strong> back to inbox
          </li>
        </ul>
      </Card>
      <Card data-testid="evening-time-by-area">
        <p className="mb-2 text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
          Where time went · {formatDuration(total)}
        </p>
        {data.timeByArea.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No sessions recorded today.</p>
        ) : null}
        <ul className="flex flex-col gap-2" aria-label="Time by area">
          {data.timeByArea.map(({ areaId, minutes }) => {
            const area = areaId ? data.areaById.get(areaId) : undefined;
            return (
              <li key={areaId ?? 'none'} className="flex flex-col gap-1 text-[13px]">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-2.5 rounded-full"
                      style={{ background: area?.color ?? '#9a9488' }}
                    />
                    {area?.name ?? 'Unassigned'}
                  </span>
                  <span className="text-ink-faint tnum">{formatDuration(minutes)}</span>
                </div>
                <ProgressBar
                  value={minutes / max}
                  label={`${area?.name ?? 'Unassigned'} time`}
                  tone="gold"
                />
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
