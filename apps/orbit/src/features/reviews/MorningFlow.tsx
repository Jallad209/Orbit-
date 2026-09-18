import type {
  Clock,
  DailyReviewStep,
  Energy,
  Id,
  LocalDate,
  PlanProposal,
  ReviewQuestionId,
  ReviewRef,
} from '@orbit/core';
import { formatDuration, systemClock, toInstant, toLocalDate } from '@orbit/core';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Repository } from '@orbit/storage';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader, Skeleton } from '@/components/ui/Card';
import { Input, Label, Select } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { useHotkey } from '@/lib/hotkeys';
import { useRepository } from '@/platform';
import { EnergyPicker, ENERGIES } from '@/features/today/EnergyPicker';
import { PlanPanel, type PlanDiff } from '@/features/today/PlanPanel';
import { settingsFor, usePlanPrefs } from '@/features/today/planSettings';
import { acceptPlan } from '@/features/today/todayService';
import { diffProposals } from '@/features/today/TodayPage';
import { createTask } from '@/features/structure/structureService';
import { createDirectReminder } from '@/features/reminders/reminderService';
import { readSettings } from '@/features/settings/settingsService';
import {
  BillCheckIn,
  EMPTY_CHECK_INS,
  PeopleCheckIn,
  ProjectCheckIn,
  type CheckInFormState,
} from './MorningCheckIn';
import {
  clearDailyReviewDraft,
  clearExpiredDailyReviewDrafts,
  loadDailyReviewDraft,
  saveDailyReviewDraft,
} from './dailyReviewService';
import { loadMorning, type MorningData } from './reviewService';
import { FlowShell } from './Stepper';

const STEP_LABEL: Record<DailyReviewStep, string> = {
  project: 'Projects',
  bill: 'Bills',
  person: 'People',
  energy: 'Energy',
  'at-risk': 'At risk',
  plan: 'Plan',
  accept: 'Accept',
};
const DEFAULT_QUESTIONS: ReviewQuestionId[] = ['project', 'bill', 'person'];

interface Props {
  clock?: Clock;
}

/**
 * The morning briefing: capture new structure one question at a time, pick
 * today's energy, review risk and the proposed plan, then accept.
 */
export function MorningFlow({ clock = systemClock }: Props) {
  const repo = useRepository();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const prefs = usePlanPrefs();
  const date: LocalDate = params.get('date') ?? toLocalDate(clock.now());
  const energy: Energy = prefs.energyByDate[date] ?? 'medium';
  const requestedStep = params.get('step') as DailyReviewStep | null;
  const [stepId, setStepId] = useState<DailyReviewStep>('project');
  const [excluded, setExcluded] = useState<readonly Id[]>([]);
  const [previous, setPrevious] = useState<PlanProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskProjectId, setTaskProjectId] = useState('');
  const [taskDate, setTaskDate] = useState<LocalDate>(date);
  const [taskTime, setTaskTime] = useState('');
  const [taskEstimate, setTaskEstimate] = useState('');
  const [captureBusy, setCaptureBusy] = useState(false);
  const [checkIns, setCheckIns] = useState<Record<ReviewQuestionId, CheckInFormState>>(() =>
    structuredClone(EMPTY_CHECK_INS),
  );
  const [checkInReady, setCheckInReady] = useState<Record<ReviewQuestionId, boolean>>({
    project: false,
    bill: false,
    person: false,
  });
  const [createdRefs, setCreatedRefs] = useState<ReviewRef[]>([]);
  const [deferredQuestions, setDeferredQuestions] = useState<ReviewQuestionId[]>([]);
  const hydrated = useRef(false);

  const { data: reviewPrefs } = useRepoQuery((r) => readSettings(r, clock), [clock]);
  const questionOrder = reviewPrefs?.reviews.questionOrder ?? DEFAULT_QUESTIONS;
  const enabledQuestions = reviewPrefs?.reviews.enabledQuestions ?? questionOrder;

  useEffect(() => {
    void clearExpiredDailyReviewDrafts(repo, toLocalDate(clock.now()));
  }, [repo, clock]);
  const flowSteps = useMemo<DailyReviewStep[]>(
    () => [
      ...questionOrder.filter((id) => enabledQuestions.includes(id)),
      'energy',
      'at-risk',
      'plan',
      'accept',
    ],
    [questionOrder, enabledQuestions],
  );
  const step = Math.max(0, flowSteps.indexOf(stepId));
  const setStep = (index: number) => setStepId(flowSteps[index] ?? flowSteps[0]!);

  const settings = useMemo(() => settingsFor(prefs, date, excluded), [prefs, date, excluded]);
  const query = useCallback(
    (r: Repository) => loadMorning(r, { date, settings, clock }),
    [date, settings, clock],
  );
  const { data, refresh } = useRepoQuery(query, [query]);

  const draftQuery = useCallback(
    (r: Repository) => loadDailyReviewDraft(r, date, 'morning'),
    [date],
  );
  const { data: draft, loading: draftLoading } = useRepoQuery(draftQuery, [draftQuery]);
  useEffect(() => {
    if (draftLoading || hydrated.current) return;
    hydrated.current = true;
    queueMicrotask(() => {
      if (!draft) {
        setStepId(
          requestedStep && flowSteps.includes(requestedStep) ? requestedStep : flowSteps[0]!,
        );
        return;
      }
      const form = draft.formState;
      if (form.checkIns && typeof form.checkIns === 'object') {
        const restored = form.checkIns as Record<ReviewQuestionId, CheckInFormState>;
        setCheckIns({
          project: { ...EMPTY_CHECK_INS.project, ...restored.project },
          bill: { ...EMPTY_CHECK_INS.bill, ...restored.bill },
          person: { ...EMPTY_CHECK_INS.person, ...restored.person },
        });
        setCheckInReady(
          Object.fromEntries(
            (['project', 'bill', 'person'] as ReviewQuestionId[]).map((id) => [
              id,
              restored[id]?.answer === 'no' ||
                restored[id]?.savedLabel === 'scheduled' ||
                (!!restored[id]?.savedLabel && restored[id]?.answer === 'yes'),
            ]),
          ) as Record<ReviewQuestionId, boolean>,
        );
      }
      if (Array.isArray(form.excluded))
        setExcluded(form.excluded.filter((id): id is Id => typeof id === 'string'));
      if (typeof form.taskTitle === 'string') setTaskTitle(form.taskTitle);
      if (typeof form.taskProjectId === 'string') setTaskProjectId(form.taskProjectId);
      if (typeof form.taskDate === 'string') setTaskDate(form.taskDate);
      if (typeof form.taskTime === 'string') setTaskTime(form.taskTime);
      if (typeof form.taskEstimate === 'string') setTaskEstimate(form.taskEstimate);
      if (typeof form.capturing === 'boolean') setCapturing(form.capturing);
      setCreatedRefs(draft.createdRefs);
      setDeferredQuestions(draft.deferredQuestions);
      const target =
        requestedStep && flowSteps.includes(requestedStep) ? requestedStep : draft.step;
      setStepId(flowSteps.includes(target) ? target : flowSteps[0]!);
    });
  }, [draft, draftLoading, flowSteps, requestedStep]);

  useEffect(() => {
    if (!hydrated.current) return;
    const timer = setTimeout(() => {
      void saveDailyReviewDraft(
        repo,
        date,
        'morning',
        {
          step: stepId,
          formState: {
            checkIns,
            excluded,
            taskTitle,
            taskProjectId,
            taskDate,
            taskTime,
            taskEstimate,
            capturing,
          },
          createdRefs,
          deferredQuestions,
          reminderTime: null,
        },
        clock,
      );
    }, 200);
    return () => clearTimeout(timer);
  }, [
    repo,
    date,
    stepId,
    checkIns,
    excluded,
    taskTitle,
    taskProjectId,
    taskDate,
    taskTime,
    taskEstimate,
    capturing,
    createdRefs,
    deferredQuestions,
    clock,
  ]);

  const setEnergy = (e: Energy) => prefs.setEnergy(date, e);
  // 1 / 2 / 3 pick the energy on the energy step only.
  const energyKey = (i: number) => () => {
    if (stepId === 'energy') setEnergy(ENERGIES[i]!);
  };
  useHotkey('1', energyKey(0), { description: 'Low energy', group: 'Morning briefing' });
  useHotkey('2', energyKey(1), { description: 'Medium energy', group: 'Morning briefing' });
  useHotkey('3', energyKey(2), { description: 'High energy', group: 'Morning briefing' });

  const diff: PlanDiff | null = useMemo(
    () => (previous && data ? diffProposals(previous, data.proposal) : null),
    [previous, data],
  );

  const accept = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await acceptPlan(repo, data.proposal, clock);
      await clearDailyReviewDraft(repo, date, 'morning');
      toast({
        title: 'Plan committed',
        description: `${data.proposal.commitment.acceptedTaskIds.length} tasks at ${energy} energy`,
        variant: 'success',
      });
      navigate('/today');
    } finally {
      setBusy(false);
    }
  };

  const activeProjects = data
    ? [...data.projectById.values()]
        .filter((project) => project.status === 'active' && project.deletedAt === null)
        .sort((a, b) => a.title.localeCompare(b.title))
    : [];

  const openCapture = () => {
    setTaskProjectId(activeProjects[0]?.id ?? '');
    setCapturing(true);
  };

  const addTask = async (event: FormEvent) => {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!title || !data) return;
    const estimateMin = taskEstimate === '' ? undefined : Number(taskEstimate);
    if (
      estimateMin !== undefined &&
      (!Number.isInteger(estimateMin) || estimateMin < 5 || estimateMin > 480)
    )
      return;
    const preferredStartMin = taskTime
      ? taskTime
          .split(':')
          .map(Number)
          .reduce((hours, minutes) => hours * 60 + minutes)
      : null;
    setCaptureBusy(true);
    setPrevious(data.proposal);
    try {
      const task = await createTask(
        repo,
        {
          title,
          projectId: taskProjectId || null,
          status: 'open',
          estimateMin,
          preferredDate: taskDate || (taskTime ? date : null),
          preferredStartMin,
        },
        clock,
      );
      setCreatedRefs((refs) => [...refs, { type: 'task', id: task.id }]);
      setTaskTitle('');
      setTaskTime('');
      setTaskEstimate('');
      refresh();
      toast({
        title: 'Task added',
        description: 'Your morning plan has been refreshed.',
        variant: 'success',
      });
    } finally {
      setCaptureBusy(false);
    }
  };

  const next = () => {
    if (step === flowSteps.length - 1) void accept();
    else setStep(step + 1);
  };

  const updateCheckIn = (id: ReviewQuestionId, patch: Partial<CheckInFormState>) =>
    setCheckIns((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

  const scheduleLater = async (id: ReviewQuestionId) => {
    const time = checkIns[id].laterTime;
    const [hour, minute] = time.split(':').map(Number) as [number, number];
    const reminderTime = hour * 60 + minute;
    const nextDeferred = [...new Set([...deferredQuestions, id])];
    const savedDraft = await saveDailyReviewDraft(
      repo,
      date,
      'morning',
      {
        step: id,
        formState: {
          checkIns,
          excluded,
          taskTitle,
          taskProjectId,
          taskDate,
          taskTime,
          taskEstimate,
          capturing,
        },
        createdRefs,
        deferredQuestions: nextDeferred,
        reminderTime,
      },
      clock,
    );
    await createDirectReminder(
      repo,
      {
        key: `review-step:${date}:${id}`,
        source: 'review-step',
        entityType: 'dailyReviewDraft',
        entityId: savedDraft.id,
        fireAt: toInstant(date, reminderTime).toISOString(),
        title: `Morning briefing · ${STEP_LABEL[id]}`,
        body: 'Continue the question you set aside.',
        destination: `/review/morning?date=${date}&step=${id}`,
      },
      clock,
    );
    updateCheckIn(id, { savedLabel: 'scheduled' });
    setDeferredQuestions(nextDeferred);
    setCheckInReady((current) => ({ ...current, [id]: true }));
    toast({
      title: 'Reminder scheduled',
      description: `Return to ${STEP_LABEL[id]} at ${time}.`,
      variant: 'success',
    });
  };

  const proposedTasks = data
    ? data.proposal.blocks.filter((b) => b.kind === 'task' || b.kind === 'routine')
    : [];

  return (
    <FlowShell
      testId="morning-flow"
      title="Morning briefing"
      subtitle={
        <>
          {date === toLocalDate(clock.now()) ? 'Today' : date}
          {data?.commitment ? (
            <>{' · '}already planned; accepting again replaces the commitment</>
          ) : null}
        </>
      }
      steps={flowSteps.map((id) => STEP_LABEL[id])}
      current={step}
      onSelect={setStep}
      onBack={() => setStep(Math.max(0, step - 1))}
      onNext={next}
      finishLabel="Accept plan"
      nextDisabled={
        !data ||
        draftLoading ||
        ((stepId === 'project' || stepId === 'bill' || stepId === 'person') &&
          !checkInReady[stepId])
      }
      busy={busy}
    >
      {!data ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-12" />
          <Skeleton className="h-40" />
        </div>
      ) : stepId === 'project' ? (
        <ProjectCheckIn
          data={data}
          clock={clock}
          state={checkIns.project}
          onChange={(patch) => updateCheckIn('project', patch)}
          templates={reviewPrefs?.reviews.templates ?? []}
          onReady={(ready) => setCheckInReady((current) => ({ ...current, project: ready }))}
          onCreated={(ref) => {
            setCreatedRefs((refs) => [...refs, ref]);
            refresh();
          }}
          onLater={() => void scheduleLater('project')}
        />
      ) : stepId === 'bill' ? (
        <BillCheckIn
          clock={clock}
          state={checkIns.bill}
          onChange={(patch) => updateCheckIn('bill', patch)}
          templates={reviewPrefs?.reviews.templates ?? []}
          onReady={(ready) => setCheckInReady((current) => ({ ...current, bill: ready }))}
          onCreated={(ref) => {
            setCreatedRefs((refs) => [...refs, ref]);
            refresh();
          }}
          onLater={() => void scheduleLater('bill')}
        />
      ) : stepId === 'person' ? (
        <PeopleCheckIn
          clock={clock}
          state={checkIns.person}
          onChange={(patch) => updateCheckIn('person', patch)}
          templates={reviewPrefs?.reviews.templates ?? []}
          onReady={(ready) => setCheckInReady((current) => ({ ...current, person: ready }))}
          onCreated={(ref) => {
            setCreatedRefs((refs) => [...refs, ref]);
            refresh();
          }}
          onLater={() => void scheduleLater('person')}
        />
      ) : stepId === 'energy' ? (
        <EnergyStep energy={energy} onChange={setEnergy} />
      ) : stepId === 'at-risk' ? (
        <AtRiskStep data={data} />
      ) : stepId === 'plan' ? (
        <div data-testid="morning-plan" data-energy={data.energy}>
          <PlanPanel
            proposal={data.proposal}
            mode="proposal"
            committedBlocks={[]}
            diff={diff}
            busy={busy}
            onRemove={(id) => setExcluded((xs) => [...xs, id])}
            onRestore={(id) => setExcluded((xs) => xs.filter((x) => x !== id))}
            onAccept={() => setStep(flowSteps.indexOf('accept'))}
            acceptLabel="Continue"
            allowEmpty
            onRegenerate={() => {
              setPrevious(data.proposal);
              refresh();
            }}
            onReplan={() => undefined}
            onCaptureTask={openCapture}
          />
          {capturing ? (
            <Card className="mt-3 border-lime/40 bg-lime/5" aria-label="Add a task">
              <SectionHeader
                title="Add a task"
                meta="Stays in this briefing"
                actions={
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCapturing(false);
                      setTaskTitle('');
                    }}
                  >
                    Done
                  </Button>
                }
              />
              <form className="grid items-end gap-3 md:grid-cols-2" onSubmit={addTask}>
                <div className="md:col-span-2">
                  <Label htmlFor="morning-task-title">Task</Label>
                  <Input
                    id="morning-task-title"
                    value={taskTitle}
                    onChange={(event) => setTaskTitle(event.target.value)}
                    placeholder="What needs to get done?"
                    autoFocus
                  />
                </div>
                <div>
                  <Label htmlFor="morning-task-project" hint="optional">
                    Project
                  </Label>
                  <Select
                    id="morning-task-project"
                    value={taskProjectId}
                    onChange={(event) => setTaskProjectId(event.target.value)}
                  >
                    <option value="">No project</option>
                    {activeProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.title}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="morning-task-date" hint="optional">
                    Plan date
                  </Label>
                  <Input
                    id="morning-task-date"
                    type="date"
                    value={taskDate}
                    onChange={(event) => setTaskDate(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="morning-task-time" hint="optional">
                    Start time
                  </Label>
                  <Input
                    id="morning-task-time"
                    type="time"
                    value={taskTime}
                    onChange={(event) => setTaskTime(event.target.value)}
                  />
                </div>
                <div>
                  <Label
                    htmlFor="morning-task-estimate"
                    hint={`optional · default ${reviewPrefs?.defaultEstimateMin ?? 30} min`}
                  >
                    Duration in minutes
                  </Label>
                  <Input
                    id="morning-task-estimate"
                    type="number"
                    min={5}
                    max={480}
                    step={5}
                    value={taskEstimate}
                    onChange={(event) => setTaskEstimate(event.target.value)}
                    placeholder={String(reviewPrefs?.defaultEstimateMin ?? 30)}
                  />
                </div>
                <p className="text-[12px] text-ink-faint md:col-span-2">
                  Date, time, and duration are optional. A start time guides this plan; Orbit moves
                  it only when another fixed item conflicts.
                </p>
                <div className="flex justify-end md:col-span-2">
                  <Button
                    type="submit"
                    variant="primary"
                    loading={captureBusy}
                    disabled={
                      !taskTitle.trim() ||
                      (taskEstimate !== '' &&
                        (!Number.isInteger(Number(taskEstimate)) ||
                          Number(taskEstimate) < 5 ||
                          Number(taskEstimate) > 480))
                    }
                  >
                    Add task
                  </Button>
                </div>
              </form>
            </Card>
          ) : null}
        </div>
      ) : (
        <AcceptStep
          data={data}
          energy={energy}
          count={proposedTasks.length}
          createdRefs={createdRefs}
        />
      )}
    </FlowShell>
  );
}

function EnergyStep({ energy, onChange }: { energy: Energy; onChange: (e: Energy) => void }) {
  return (
    <Card className="flex flex-col items-start gap-3">
      <p className="text-sm text-ink-muted">
        How much do you have today? Low leaves demanding work out; high lets it in.
      </p>
      <EnergyPicker value={energy} onChange={onChange} size="lg" hints />
    </Card>
  );
}

function AtRiskStep({ data }: { data: MorningData }) {
  const { overdue, dueSoon, projects } = data.atRisk;
  const total = overdue.length + dueSoon.length + projects.length;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card data-testid="morning-at-risk">
        <p className="mb-2 text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
          At risk {total ? `· ${total}` : ''}
        </p>
        {total === 0 ? <p className="text-[13px] text-ink-muted">Nothing is slipping.</p> : null}
        <ul className="flex flex-col gap-1 text-sm" aria-label="At risk">
          {overdue.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <Badge tone="danger">Overdue</Badge>
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span className="text-[12px] text-ink-faint tnum">
                {toLocalDate(new Date(t.dueAt!))}
              </span>
            </li>
          ))}
          {dueSoon.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <Badge tone="gold">Due soon</Badge>
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span className="text-[12px] text-ink-faint tnum">
                {toLocalDate(new Date(t.dueAt!))}
              </span>
            </li>
          ))}
          {projects.map(({ project, health }) => (
            <li key={project.id} className="flex items-center gap-2">
              <Badge tone={health.overdue ? 'danger' : 'gold'}>
                {health.overdue
                  ? `Overdue ${-health.daysToDeadline!}d`
                  : `${health.daysToDeadline}d left`}
              </Badge>
              <Link
                to={`/projects/${project.id}`}
                className="min-w-0 flex-1 truncate hover:underline"
              >
                {project.title}
              </Link>
              <span className="text-[12px] text-ink-faint tnum">
                {Math.round(health.progress * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card data-testid="morning-bills">
        <p className="mb-2 text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
          Bills due {data.billsDue.length ? `· ${data.billsDue.length}` : ''}
        </p>
        {data.billsDue.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Nothing due in the next three days.</p>
        ) : null}
        <ul className="flex flex-col gap-1 text-sm" aria-label="Bills due">
          {data.billsDue.map((b) => (
            <li key={b.id} className="flex items-center gap-2">
              <Badge tone={b.dueAt !== null && b.dueAt < data.date ? 'danger' : 'gold'}>
                {b.dueAt ?? 'No date'}
              </Badge>
              <span className="min-w-0 flex-1 truncate">{b.title}</span>
              <span className="text-[12px] text-ink-faint tnum">
                {b.amount} {b.currency}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function AcceptStep({
  data,
  energy,
  count,
  createdRefs,
}: {
  data: MorningData;
  energy: Energy;
  count: number;
  createdRefs: ReviewRef[];
}) {
  const unique = [...new Map(createdRefs.map((ref) => [`${ref.type}:${ref.id}`, ref])).values()];
  const refKey = unique.map((ref) => `${ref.type}:${ref.id}`).join('|');
  const { data: labels } = useRepoQuery(
    async (repo) => {
      const entries = await Promise.all(
        unique.map(async (ref): Promise<[string, string]> => {
          const key = `${ref.type}:${ref.id}`;
          switch (ref.type) {
            case 'project':
              return [key, (await repo.projects.get(ref.id))?.title ?? 'Deleted project'];
            case 'bill':
              return [key, (await repo.bills.get(ref.id))?.title ?? 'Deleted bill'];
            case 'person':
              return [key, (await repo.people.get(ref.id))?.name ?? 'Deleted person'];
            case 'task':
              return [key, (await repo.tasks.get(ref.id))?.title ?? 'Deleted task'];
            default:
              return [key, ref.type];
          }
        }),
      );
      return new Map(entries);
    },
    [refKey],
  );
  const path = (ref: ReviewRef) =>
    ref.type === 'project'
      ? `/projects/${ref.id}`
      : ref.type === 'bill'
        ? `/bills/${ref.id}`
        : ref.type === 'person'
          ? `/people/${ref.id}`
          : ref.type === 'task'
            ? `/tasks/${ref.id}`
            : null;
  return (
    <Card data-testid="morning-summary" className="flex flex-col gap-3">
      <p className="text-sm text-ink">
        <strong>{count}</strong> block{count === 1 ? '' : 's'} ·{' '}
        <strong>{formatDuration(data.proposal.stats.plannedMin)}</strong> planned of{' '}
        {formatDuration(data.proposal.stats.freeMin)} free · <strong>{energy}</strong> energy
      </p>
      <p className="mt-2 text-[13px] text-ink-muted">
        {count === 0
          ? 'Nothing is planned, and that can be the right plan. Accept to keep the day intentionally open.'
          : 'Accepting writes the commitment and the blocks; the Today screen takes over from there.'}
      </p>
      <div className="border-t border-line pt-3">
        <p className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
          Added during this briefing · {unique.length}
        </p>
        {unique.length ? (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Added during this briefing">
            {unique.map((ref) => {
              const to = path(ref);
              return (
                <li key={`${ref.type}:${ref.id}`}>
                  {to ? (
                    <Link
                      to={to}
                      className="rounded-md border border-line px-2 py-1 text-[13px] hover:bg-surface-2"
                    >
                      {labels?.get(`${ref.type}:${ref.id}`) ?? 'Loading…'}
                    </Link>
                  ) : (
                    <span className="text-[13px] text-ink-muted">{ref.type}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 text-[13px] text-ink-faint">Nothing new was added.</p>
        )}
      </div>
    </Card>
  );
}
