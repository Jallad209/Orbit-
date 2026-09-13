import { formatDuration, parseDuration, systemClock } from '@orbit/core';
import type { Clock, Task } from '@orbit/core';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/Dialog';
import { FieldError, Input, Label } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { useRepository } from '@/platform';
import { completeTask } from '@/features/structure/structureService';

interface Props {
  /** The task being completed; null closes the dialog. */
  task: Task | null;
  onClose: () => void;
  onCompleted?: (task: Task) => void;
  clock?: Clock;
}

/**
 * "How long did it take?" when a task is completed without a timer. Prefills
 * the estimate and accepts `25`, `1h`, or `1h30`. When the task already has
 * a session the dialog never shows: the sessions are the answer.
 */
export function CompleteTaskDialog({ task, onClose, onCompleted, clock = systemClock }: Props) {
  const repo = useRepository();
  const inputId = useId();
  /** Which task the session check ran for, and whether it should be asked about. */
  const [checked, setChecked] = useState<{ taskId: string; prompt: boolean } | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const prompting = task && checked?.taskId === task.id && checked.prompt ? task : null;

  useEffect(() => {
    if (!task) return;
    let cancelled = false;
    void (async () => {
      const sessions = await repo.sessions.query((s) => s.taskId === task.id);
      if (cancelled) return;
      if (sessions.length) {
        const done = await completeTask(repo, task, null, clock);
        if (cancelled) return;
        toast({ title: 'Done', description: task.title, variant: 'success' });
        onCompleted?.(done);
        onClose();
        return;
      }
      setText(formatDuration(task.estimateMin));
      setError(null);
      setChecked({ taskId: task.id, prompt: true });
    })();
    return () => {
      cancelled = true;
    };
    // The callbacks are read once per task; re-running on every render would re-complete.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, repo, clock]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!prompting) return;
    const minutes = parseDuration(text);
    if (minutes === null) {
      setError('Enter minutes like 25, 1h, or 1h30.');
      return;
    }
    setBusy(true);
    try {
      const done = await completeTask(repo, prompting, minutes, clock);
      toast({
        title: 'Done',
        description: `${prompting.title} · ${formatDuration(minutes)}`,
        variant: 'success',
      });
      onCompleted?.(done);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    if (!prompting) return;
    setBusy(true);
    try {
      const done = await completeTask(repo, prompting, null, clock);
      toast({ title: 'Done', description: prompting.title, variant: 'success' });
      onCompleted?.(done);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={prompting !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="sm" aria-describedby={undefined} data-testid="complete-dialog">
        <form onSubmit={submit}>
          <DialogTitle>How long did it take?</DialogTitle>
          <DialogDescription>
            {prompting?.title}
            {prompting ? ` · estimated ${formatDuration(prompting.estimateMin)}` : ''}
          </DialogDescription>
          <div className="mt-4">
            <Label htmlFor={inputId} hint="25, 1h, 1h30">
              Actual time
            </Label>
            <Input
              id={inputId}
              className="mt-1"
              aria-label="Actual time"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
              invalid={!!error}
              aria-describedby={error ? `${inputId}-error` : undefined}
              autoFocus
              onFocus={(e) => e.target.select()}
            />
            <FieldError id={`${inputId}-error`}>{error ?? undefined}</FieldError>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={skip} disabled={busy}>
              Skip
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Complete
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
