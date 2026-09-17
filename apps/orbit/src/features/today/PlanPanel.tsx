import type { Id, LeftOutReason, PlanProposal, ProposedBlock } from '@orbit/core';
import { formatDuration, formatMinute } from '@orbit/core';
import { CalendarCheck, RefreshCw, RotateCcw, Undo2, X } from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonVariants } from '@/components/ui/Button';
import { Card, EmptyState, SectionHeader } from '@/components/ui/Card';
import { WhyPopover } from './WhyPopover';

export const LEFT_OUT_LABELS: Record<LeftOutReason, string> = {
  blocked: 'Blocked',
  energy: 'Energy',
  capacity: 'No room',
  lowScore: 'Low score',
  scheduled: 'Already scheduled',
  user: 'Removed',
};

export interface PlanDiff {
  added: Set<Id>;
  removed: Array<{ id: Id; title: string }>;
}

interface Props {
  proposal: PlanProposal;
  mode: 'proposal' | 'committed';
  committedBlocks: ProposedBlock[];
  diff: PlanDiff | null;
  busy: boolean;
  onRemove: (taskId: Id) => void;
  onRestore: (taskId: Id) => void;
  onAccept: () => void;
  onRegenerate: () => void;
  onReplan: () => void;
  /** Keeps task capture in the current flow when a host provides it. */
  onCaptureTask?: () => void;
  /** A host flow may use this action to advance to its own confirmation step. */
  acceptLabel?: string;
  /** Empty days are valid in the morning briefing. */
  allowEmpty?: boolean;
}

function rangeLabel(b: ProposedBlock): string {
  return `${formatMinute(b.startMin)}–${formatMinute(b.endMin)}`;
}

/** The proposal: what, when, why, and what was left out. */
export function PlanPanel({
  proposal,
  mode,
  committedBlocks,
  diff,
  busy,
  onRemove,
  onRestore,
  onAccept,
  onRegenerate,
  onReplan,
  onCaptureTask,
  acceptLabel = 'Accept',
  allowEmpty = false,
}: Props) {
  const proposed = proposal.blocks.filter((b) => b.kind === 'task' || b.kind === 'routine');
  const plannedMin = proposal.stats.plannedMin;

  if (mode === 'committed') {
    const work = committedBlocks.filter((b) => b.kind !== 'event');
    const minutes = work.reduce((m, b) => m + (b.endMin - b.startMin), 0);
    return (
      <Card data-testid="plan-panel" data-mode="committed">
        <SectionHeader
          title="Committed"
          meta={`${work.length} block${work.length === 1 ? '' : 's'} · ${formatDuration(minutes)}`}
          actions={
            <Button size="sm" variant="ghost" onClick={onReplan}>
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Re-plan
            </Button>
          }
        />
        <ul className="flex flex-col gap-1" aria-label="Committed plan">
          {work.map((b) => (
            <li key={b.key} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm">
              <span className="w-24 shrink-0 text-[12px] text-ink-faint tnum">{rangeLabel(b)}</span>
              <span className="min-w-0 flex-1 truncate">{b.title}</span>
              {b.locked ? <Badge tone="outline">Locked</Badge> : null}
            </li>
          ))}
        </ul>
        {work.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Nothing is scheduled for this day.</p>
        ) : null}
      </Card>
    );
  }

  return (
    <Card data-testid="plan-panel" data-mode="proposal">
      <SectionHeader
        title="Proposed plan"
        meta={
          proposed.length
            ? `${proposed.length} · ${formatDuration(plannedMin)} of ${formatDuration(proposal.stats.freeMin)} free`
            : undefined
        }
        actions={
          <>
            {onCaptureTask && proposed.length > 0 ? (
              <Button size="sm" variant="ghost" onClick={onCaptureTask} disabled={busy}>
                Add task
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onRegenerate} disabled={busy}>
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Regenerate
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={onAccept}
              loading={busy}
              disabled={!allowEmpty && proposed.length === 0}
            >
              <CalendarCheck className="size-3.5" aria-hidden="true" />
              {acceptLabel}
            </Button>
          </>
        }
      />

      {diff && diff.removed.length ? (
        <p className="mb-2 text-[12px] text-ink-muted" data-testid="plan-diff">
          Dropped since last plan: {diff.removed.map((r) => r.title).join(', ')}
        </p>
      ) : null}

      {proposed.length === 0 ? (
        <EmptyState
          title="Nothing to plan"
          description={
            proposal.stats.freeMin === 0
              ? 'No free time left in the working window.'
              : 'Add an open task and Orbit will propose a day.'
          }
          action={
            proposal.stats.freeMin === 0 ? undefined : (
              <div className="flex items-center gap-2">
                {onCaptureTask ? (
                  <Button size="sm" variant="primary" onClick={onCaptureTask}>
                    Capture a task
                  </Button>
                ) : (
                  <Link to="/inbox" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
                    Capture a task
                  </Link>
                )}
                <Link
                  to="/projects"
                  className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                >
                  Open projects
                </Link>
              </div>
            )
          }
        />
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Proposed plan">
          {proposed.map((b) => {
            const id = b.taskId ?? b.routineInstanceId!;
            const why = proposal.explanations[id];
            const isNew = diff?.added.has(id) ?? false;
            return (
              <li
                key={b.key}
                data-testid={`plan-row-${id}`}
                className={
                  'group flex items-center gap-3 rounded-md px-2 py-1.5 text-sm ' +
                  (isNew ? 'bg-lime/25 animate-fade-in' : 'hover:bg-surface-2')
                }
              >
                <span className="w-24 shrink-0 text-[12px] text-ink-faint tnum">
                  {rangeLabel(b)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {b.title}
                  {b.part ? (
                    <span className="ml-1 text-ink-faint">
                      part {b.part.index + 1}/{b.part.of}
                    </span>
                  ) : null}
                </span>
                {isNew ? <Badge tone="lime">New</Badge> : null}
                {b.kind === 'routine' ? <Badge tone="routine">Routine</Badge> : null}
                <span className="w-12 text-right text-[12px] text-ink-faint tnum">
                  {formatDuration(b.endMin - b.startMin)}
                </span>
                {why ? <WhyPopover title={b.title} why={why} /> : null}
                {b.taskId && (!b.part || b.part.index === 0) ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${b.title}`}
                    onClick={() => onRemove(b.taskId!)}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                ) : (
                  <span className="size-8" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {proposal.leftOut.length ? (
        <details
          className="mt-3 text-[13px]"
          open={proposal.leftOut.some((l) => l.reason === 'user')}
        >
          <summary className="cursor-pointer text-ink-muted select-none">
            Left out ({proposal.leftOut.length})
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1" aria-label="Left out">
            {proposal.leftOut.map((l) => (
              <li
                key={l.id}
                data-testid={`left-out-${l.id}`}
                data-reason={l.reason}
                className="flex items-center gap-2 rounded-md px-2 py-1"
              >
                <span className="min-w-0 flex-1 truncate text-ink-muted">{l.title}</span>
                <span
                  className="hidden truncate text-[12px] text-ink-faint sm:inline"
                  title={l.detail}
                >
                  {l.detail}
                </span>
                <Badge
                  tone={
                    l.reason === 'blocked' ? 'danger' : l.reason === 'user' ? 'outline' : 'neutral'
                  }
                >
                  {LEFT_OUT_LABELS[l.reason]}
                </Badge>
                {l.reason === 'user' ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Add back ${l.title}`}
                    onClick={() => onRestore(l.id)}
                  >
                    <Undo2 className="size-4" aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
