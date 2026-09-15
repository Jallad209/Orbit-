import { recordFingerprint, systemClock, toLocalDate } from '@orbit/core';
import type { Clock, WeeklyReviewStepDraft } from '@orbit/core';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { routeFor } from '@/lib/destinations';
import type { StepSession } from '../useReviewSession';
import {
  archiveTaskWithin,
  completeTaskWithin,
  inboxTaskWithin,
  loadOverdueStep,
  rescheduleTaskWithin,
} from '../weeklyService';
import { StepFrame } from './StepFrame';

export type OverdueChoice =
  | { action: 'reschedule'; date: string }
  | { action: 'inbox'; clearDeadline: boolean }
  | { action: 'archive' }
  | { action: 'complete' }
  | { action: 'defer' };

export type OverdueChoices = Record<string, { choice: OverdueChoice; baseFingerprint: string }>;

interface Props {
  session: StepSession;
  /** Unsubmitted choices restored from a paused review. */
  draft: WeeklyReviewStepDraft | null;
  /** The current unsubmitted choices, for Pause to save. */
  onDraftChange: (choices: OverdueChoices) => void;
  clock?: Clock;
}

/**
 * Step 2: every live unfinished task whose deadline has passed. Choices
 * are made per task and applied explicitly; Pause saves the unapplied
 * choices and Resume puts them back. Rescheduling moves the deadline only:
 * a block left on its old date is reported with a Timeline link, never
 * moved. Nothing is rolled over on its own.
 */
export function OverdueStep({ session, draft, onDraftChange, clock = systemClock }: Props) {
  const { data } = useRepoQuery((r) => loadOverdueStep(r, clock), [session.review.revision]);
  const [choices, setChoices] = useState<OverdueChoices>(() => restore(draft));
  const [applying, setApplying] = useState(false);
  useEffect(() => onDraftChange(choices), [choices, onDraftChange]);
  if (!data) return <p className="text-sm text-ink-muted">Loading…</p>;
  const items = data.tasks.map((t) => ({ type: 'task' as const, id: t.task.id }));

  const set = (id: string, choice: OverdueChoice, base: string) =>
    setChoices((c) => ({ ...c, [id]: { choice, baseFingerprint: base } }));

  const apply = async () => {
    setApplying(true);
    try {
      for (const row of data.tasks) {
        const entry = choices[row.task.id];
        if (!entry || session.decided.has(`task:${row.task.id}`)) continue;
        const ref = { type: 'task' as const, id: row.task.id };
        const fp = data.fingerprint;
        if (entry.baseFingerprint !== recordFingerprint(row.task)) {
          toast({
            title: 'Changed since reviewed',
            description: `“${row.task.title}” changed after you chose; look again.`,
            variant: 'warning',
          });
          continue;
        }
        const c = entry.choice;
        let ok: unknown = null;
        if (c.action === 'reschedule') {
          const dueAt = new Date(`${c.date}T23:59`).toISOString();
          ok = await session.submit('reschedule-task', [ref], fp, { dueAt }, (tx) =>
            rescheduleTaskWithin(tx, row.task.id, dueAt),
          );
          const result = (ok as { result?: { blocksLeftOnOldDates: number } } | null)?.result;
          if (result && result.blocksLeftOnOldDates > 0)
            toast({
              title: 'Deadline moved; the block stayed',
              description: `${result.blocksLeftOnOldDates} block${result.blocksLeftOnOldDates === 1 ? '' : 's'} for “${row.task.title}” remain on their old date. Move them on the Timeline if you want.`,
              variant: 'warning',
            });
        } else if (c.action === 'inbox') {
          ok = await session.submit(
            'inbox-task',
            [ref],
            fp,
            { clearDeadline: c.clearDeadline },
            (tx) => inboxTaskWithin(tx, row.task.id, { clearDeadline: c.clearDeadline }),
          );
        } else if (c.action === 'archive') {
          ok = await session.submit('archive-task', [ref], fp, {}, (tx) =>
            archiveTaskWithin(tx, row.task.id),
          );
        } else if (c.action === 'complete') {
          ok = await session.submit('complete-task', [ref], fp, { actualMin: null }, (tx) =>
            completeTaskWithin(tx, row.task.id, null, clock),
          );
        } else {
          ok = (await session.defer(ref, fp)) ? {} : null;
        }
        if (ok === null) break;
        setChoices((all) => {
          const next = { ...all };
          delete next[row.task.id];
          return next;
        });
      }
    } finally {
      setApplying(false);
    }
  };

  const pending = data.tasks.filter(
    (t) => choices[t.task.id] && !session.decided.has(`task:${t.task.id}`),
  ).length;
  const today = toLocalDate(clock.now());

  return (
    <StepFrame
      session={session}
      items={items}
      fingerprint={data.fingerprint}
      intro="Tasks whose deadline passed. Choose what happens to each — a new deadline, back to the inbox, archive, complete, or keep it and defer — then apply. Nothing is rolled over for you."
      gate="Choose and apply, or defer them."
    >
      {data.tasks.length === 0 ? (
        <p className="text-[13px] text-ink-faint">Nothing is overdue.</p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {data.tasks.map((row) => {
          const decided = session.decided.has(`task:${row.task.id}`);
          const entry = choices[row.task.id];
          const action = entry?.choice.action ?? '';
          const base = recordFingerprint(row.task);
          return (
            <li
              key={row.task.id}
              className="flex flex-col gap-1 rounded-md border border-line px-3 py-2 text-sm"
              data-testid="overdue-task"
              data-decided={decided}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={routeFor({ type: 'task', id: row.task.id })!}
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                >
                  {row.task.title}
                </Link>
                <Badge tone="danger">due {row.task.dueAt!.slice(0, 10)}</Badge>
                <Badge tone="outline">P{row.task.priority}</Badge>
                {row.project ? (
                  <Link
                    to={routeFor({ type: 'project', id: row.project.id })!}
                    className="text-[12px] text-ink-muted hover:underline"
                  >
                    {row.project.title}
                  </Link>
                ) : null}
                {row.accepted ? <Badge tone="lime">accepted</Badge> : null}
                {row.blocks.map((b) => (
                  <Link
                    key={b.id}
                    to={routeFor({ type: 'timelineBlock', id: b.id, date: b.date })!}
                    className="text-[12px] underline"
                  >
                    block {b.date}
                    {b.locked ? ' (locked)' : ''}
                  </Link>
                ))}
                {row.blockers.length ? (
                  <Badge tone="gold">waits on {row.blockers.length}</Badge>
                ) : null}
                {decided ? <Badge tone="ok">decided</Badge> : null}
              </div>
              {!decided ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    aria-label={`Choice for ${row.task.title}`}
                    value={action}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === 'reschedule')
                        set(row.task.id, { action: 'reschedule', date: today }, base);
                      else if (v === 'inbox')
                        set(row.task.id, { action: 'inbox', clearDeadline: true }, base);
                      else if (v === 'archive') set(row.task.id, { action: 'archive' }, base);
                      else if (v === 'complete') set(row.task.id, { action: 'complete' }, base);
                      else if (v === 'defer') set(row.task.id, { action: 'defer' }, base);
                      else
                        setChoices((c) => {
                          const next = { ...c };
                          delete next[row.task.id];
                          return next;
                        });
                    }}
                    className="h-8 w-48"
                  >
                    <option value="">Choose…</option>
                    <option value="reschedule">Reschedule to a date</option>
                    <option value="inbox">Return to inbox</option>
                    <option value="archive">Archive (drop it)</option>
                    <option value="complete">Mark complete</option>
                    <option value="defer">Keep and defer</option>
                  </Select>
                  {entry?.choice.action === 'reschedule' ? (
                    <Input
                      type="date"
                      aria-label={`New date for ${row.task.title}`}
                      value={entry.choice.date}
                      onChange={(e) =>
                        set(row.task.id, { action: 'reschedule', date: e.target.value }, base)
                      }
                      className="h-8 w-40"
                    />
                  ) : null}
                  {entry?.choice.action === 'inbox' ? (
                    <label className="flex items-center gap-1 text-[12px] text-ink-muted">
                      <input
                        type="checkbox"
                        checked={entry.choice.clearDeadline}
                        onChange={(e) =>
                          set(
                            row.task.id,
                            { action: 'inbox', clearDeadline: e.target.checked },
                            base,
                          )
                        }
                      />
                      clear the deadline
                    </label>
                  ) : null}
                  {entry?.choice.action === 'archive' ? (
                    <span className="text-[12px] text-ink-faint">
                      Archives the task and clears any next-action pointer to it.
                    </span>
                  ) : null}
                  {entry?.choice.action === 'complete' ? (
                    <span className="text-[12px] text-ink-faint">
                      Marks it done now; a running timer is stopped first.
                    </span>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {data.tasks.length ? (
        <div>
          <Button
            variant="primary"
            onClick={() => void apply()}
            disabled={pending === 0 || applying || session.busy || session.stale}
            loading={applying}
            data-testid="apply-choices"
          >
            Apply {pending} choice{pending === 1 ? '' : 's'}
          </Button>
          <span className="ml-2 text-[12px] text-ink-faint">
            Unapplied choices are saved with Pause and restored on Resume.
          </span>
        </div>
      ) : null}
    </StepFrame>
  );
}

function restore(draft: WeeklyReviewStepDraft | null): OverdueChoices {
  const out: OverdueChoices = {};
  if (!draft || draft.step !== 'overdue') return out;
  for (const c of draft.choices) {
    const choice = c.choice as Partial<OverdueChoice>;
    if (!choice.action) continue;
    out[c.ref.id] = { choice: choice as OverdueChoice, baseFingerprint: c.baseFingerprint };
  }
  return out;
}

/** The unapplied choices as a step draft for Pause. */
export function toDraft(
  choices: OverdueChoices,
): Omit<WeeklyReviewStepDraft, 'version' | 'savedAt'> {
  return {
    step: 'overdue',
    choices: Object.entries(choices).map(([id, c]) => ({
      ref: { type: 'task', id },
      baseFingerprint: c.baseFingerprint,
      choice: c.choice as unknown as Record<string, unknown>,
    })),
  };
}
