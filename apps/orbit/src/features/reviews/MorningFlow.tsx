import type { Clock, Energy, Id, LocalDate, PlanProposal } from '@orbit/core';
import { formatDuration, systemClock, toLocalDate } from '@orbit/core';
import { useCallback, useMemo, useState } from 'react';
import type { Repository } from '@orbit/storage';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Card, Skeleton } from '@/components/ui/Card';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { useHotkey } from '@/lib/hotkeys';
import { useRepository } from '@/platform';
import { EnergyPicker, ENERGIES } from '@/features/today/EnergyPicker';
import { PlanPanel, type PlanDiff } from '@/features/today/PlanPanel';
import { settingsFor, usePlanPrefs } from '@/features/today/planSettings';
import { acceptPlan } from '@/features/today/todayService';
import { diffProposals } from '@/features/today/TodayPage';
import { loadMorning, type MorningData } from './reviewService';
import { FlowShell } from './Stepper';

const STEPS = ['Energy', 'At risk', 'Plan', 'Accept'] as const;

interface Props {
  clock?: Clock;
}

/**
 * The morning briefing: pick today's energy, see what is slipping and what
 * is due, look over the proposal, accept. Four steps, keyboard-only capable.
 */
export function MorningFlow({ clock = systemClock }: Props) {
  const repo = useRepository();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const prefs = usePlanPrefs();
  const date: LocalDate = params.get('date') ?? toLocalDate(clock.now());
  const energy: Energy = prefs.energyByDate[date] ?? 'medium';
  const [step, setStep] = useState(0);
  const [excluded, setExcluded] = useState<readonly Id[]>([]);
  const [previous, setPrevious] = useState<PlanProposal | null>(null);
  const [busy, setBusy] = useState(false);

  const settings = useMemo(() => settingsFor(prefs, date, excluded), [prefs, date, excluded]);
  const query = useCallback(
    (r: Repository) => loadMorning(r, { date, settings, clock }),
    [date, settings, clock],
  );
  const { data, refresh } = useRepoQuery(query, [query]);

  const setEnergy = (e: Energy) => prefs.setEnergy(date, e);
  // 1 / 2 / 3 pick the energy on the first step only.
  const energyKey = (i: number) => () => {
    if (step === 0) setEnergy(ENERGIES[i]!);
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

  const next = () => {
    if (step === STEPS.length - 1) void accept();
    else setStep((s) => s + 1);
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
      steps={STEPS}
      current={step}
      onSelect={setStep}
      onBack={() => setStep((s) => Math.max(0, s - 1))}
      onNext={next}
      finishLabel="Accept plan"
      nextDisabled={!data || (step === STEPS.length - 1 && proposedTasks.length === 0)}
      busy={busy}
    >
      {!data ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-12" />
          <Skeleton className="h-40" />
        </div>
      ) : step === 0 ? (
        <EnergyStep energy={energy} onChange={setEnergy} />
      ) : step === 1 ? (
        <AtRiskStep data={data} />
      ) : step === 2 ? (
        <div data-testid="morning-plan" data-energy={data.energy}>
          <PlanPanel
            proposal={data.proposal}
            mode="proposal"
            committedBlocks={[]}
            diff={diff}
            busy={busy}
            onRemove={(id) => setExcluded((xs) => [...xs, id])}
            onRestore={(id) => setExcluded((xs) => xs.filter((x) => x !== id))}
            onAccept={accept}
            onRegenerate={() => {
              setPrevious(data.proposal);
              refresh();
            }}
            onReplan={() => undefined}
          />
        </div>
      ) : (
        <AcceptStep data={data} energy={energy} count={proposedTasks.length} />
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
              <Badge tone={b.dueAt < data.date ? 'danger' : 'gold'}>{b.dueAt}</Badge>
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

function AcceptStep({ data, energy, count }: { data: MorningData; energy: Energy; count: number }) {
  return (
    <Card data-testid="morning-summary">
      <p className="text-sm text-ink">
        <strong>{count}</strong> block{count === 1 ? '' : 's'} ·{' '}
        <strong>{formatDuration(data.proposal.stats.plannedMin)}</strong> planned of{' '}
        {formatDuration(data.proposal.stats.freeMin)} free · <strong>{energy}</strong> energy
      </p>
      <p className="mt-2 text-[13px] text-ink-muted">
        {count === 0
          ? 'Nothing to accept. Go back to the plan or add tasks to a project.'
          : 'Accepting writes the commitment and the blocks; the Today screen takes over from there.'}
      </p>
    </Card>
  );
}
