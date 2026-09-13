import type { Clock, ProposedBlock } from '@orbit/core';
import { formatDuration, formatMinute } from '@orbit/core';
import { Check, Play, Square } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/toastStore';
import { useRepository } from '@/platform';
import { completeTask } from '@/features/structure/structureService';
import type { TodayData } from './todayService';
import { startSession, stopSession } from './todayService';

interface Props {
  data: TodayData;
  block: ProposedBlock | null;
  mode: 'proposal' | 'committed';
  clock: Clock;
}

/** The one dominant element: what to do next, with Start and Done. */
export function FocusHeader({ data, block, mode, clock }: Props) {
  const repo = useRepository();
  const [busy, setBusy] = useState(false);
  const task = block?.taskId ? data.taskById.get(block.taskId) : undefined;
  const project = task?.projectId ? data.projectById.get(task.projectId) : undefined;
  const running = data.runningSession && task && data.runningSession.taskId === task.id;

  const toggleSession = async () => {
    if (!task) return;
    setBusy(true);
    try {
      if (running) {
        await stopSession(repo, data.runningSession!, clock);
        toast('Session stopped');
      } else {
        await startSession(repo, task.id, clock);
        toast({ title: 'Session started', description: task.title });
      }
    } finally {
      setBusy(false);
    }
  };

  const done = async () => {
    if (!task) return;
    setBusy(true);
    try {
      if (running) await stopSession(repo, data.runningSession!, clock);
      await completeTask(repo, task, null, clock);
      toast({ title: 'Done', description: task.title, variant: 'success' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="focus-title"
      data-testid="focus"
      className="rounded-lg border border-line bg-nav px-5 py-4 text-nav-fg"
    >
      <p className="text-[12px] font-semibold tracking-wide text-nav-muted uppercase">
        {mode === 'committed' ? 'Next' : 'Proposed next'}
      </p>
      {task && block ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="min-w-0 flex-1">
            <h2 id="focus-title" className="truncate text-h1 font-semibold tracking-tight">
              {task.title}
            </h2>
            <p className="mt-0.5 text-[13px] text-nav-muted">
              {formatMinute(block.startMin)}–{formatMinute(block.endMin)} ·{' '}
              {formatDuration(block.endMin - block.startMin)}
              {project ? (
                <>
                  {' · '}
                  <Link to={`/projects/${project.id}`} className="hover:underline">
                    {project.title}
                  </Link>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={running ? 'gold' : 'primary'}
              onClick={toggleSession}
              loading={busy}
              aria-pressed={!!running}
            >
              {running ? (
                <Square className="size-4" aria-hidden="true" />
              ) : (
                <Play className="size-4" aria-hidden="true" />
              )}
              {running ? 'Stop' : 'Start'}
            </Button>
            <Button variant="secondary" onClick={done} disabled={busy}>
              <Check className="size-4" aria-hidden="true" />
              Done
            </Button>
          </div>
        </div>
      ) : (
        <h2 id="focus-title" className="mt-1 text-h1 font-semibold tracking-tight text-nav-fg/80">
          Nothing planned yet
        </h2>
      )}
    </section>
  );
}
