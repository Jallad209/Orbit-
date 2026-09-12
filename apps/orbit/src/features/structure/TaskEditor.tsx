import {
  DependencyError,
  HierarchyError,
  formatDuration,
  parseDuration,
  wouldCreateCycle,
} from '@orbit/core';
import type { Project, Task } from '@orbit/core';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/Drawer';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { useRepository } from '@/platform';
import { archiveTask, updateTask } from './structureService';

export interface TaskEditorProps {
  task: Task | null;
  /** All live tasks, for dependency choices and cycle checks. */
  tasks: Task[];
  projects: Project[];
  onClose: () => void;
}

/** Drawer for editing every task field, with duration parsing and safe dependencies. */
export function TaskEditor({ task, tasks, projects, onClose }: TaskEditorProps) {
  return (
    <Drawer open={!!task} onOpenChange={(o) => !o && onClose()}>
      {task ? (
        <DrawerContent aria-describedby={undefined}>
          {/* Keyed by id so a different task mounts a fresh form with its own initial state. */}
          <TaskForm key={task.id} task={task} tasks={tasks} projects={projects} onClose={onClose} />
        </DrawerContent>
      ) : null}
    </Drawer>
  );
}

function localDateParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { date, time: hm === '23:59' ? '' : hm };
}

function TaskForm({ task, tasks, projects, onClose }: TaskEditorProps & { task: Task }) {
  const repo = useRepository();
  const initialDue = task.dueAt ? localDateParts(task.dueAt) : { date: '', time: '' };
  const [title, setTitle] = useState(task.title);
  const [projectId, setProjectId] = useState(task.projectId ?? '');
  const [estimate, setEstimate] = useState(formatDuration(task.estimateMin));
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState(initialDue.date);
  const [dueTime, setDueTime] = useState(initialDue.time);
  const [energy, setEnergy] = useState<Task['energy']>(task.energy);
  const [priority, setPriority] = useState(task.priority);
  const [dependsOn, setDependsOn] = useState<string[]>(task.dependsOn);
  const [notes, setNotes] = useState(task.notes);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const siblings = tasks.filter(
    (t) =>
      t.id !== task.id &&
      t.status !== 'archived' &&
      (projectId ? t.projectId === projectId : t.projectId === null),
  );

  const save = async () => {
    const est = parseDuration(estimate);
    if (est === null) {
      setEstimateError('Enter minutes, like 45 or 1h30');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let dueAt: string | null = null;
      if (dueDate) {
        const [y, m, d] = dueDate.split('-').map(Number) as [number, number, number];
        const [hh, mm] = dueTime ? (dueTime.split(':').map(Number) as [number, number]) : [23, 59];
        dueAt = new Date(y, m - 1, d, hh, mm).toISOString();
      }
      await updateTask(repo, task, {
        title: title.trim() || task.title,
        projectId: projectId || null,
        estimateMin: est,
        dueAt,
        energy,
        priority,
        dependsOn,
        notes,
      });
      onClose();
    } catch (e) {
      if (e instanceof DependencyError || e instanceof HierarchyError) setError(e.message);
      else throw e;
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>Edit task</DrawerTitle>
      </DrawerHeader>
      <DrawerBody className="flex flex-col gap-4">
        <div>
          <Label htmlFor="task-title">Title</Label>
          <Input
            id="task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="task-project">Project</Label>
            <Select
              id="task-project"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setDependsOn([]);
              }}
              className="mt-1"
            >
              <option value="">No project</option>
              {projects
                .filter((p) => p.status !== 'archived')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="task-estimate" hint="45, 1h30, 2h">
              Estimate
            </Label>
            <Input
              id="task-estimate"
              value={estimate}
              invalid={!!estimateError}
              aria-describedby={estimateError ? 'task-estimate-err' : undefined}
              onChange={(e) => {
                setEstimate(e.target.value);
                setEstimateError(
                  parseDuration(e.target.value) === null ? 'Enter minutes, like 45 or 1h30' : null,
                );
              }}
              className="mt-1"
            />
            <FieldError id="task-estimate-err">{estimateError ?? undefined}</FieldError>
          </div>
          <div>
            <Label htmlFor="task-due">Due date</Label>
            <Input
              id="task-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="task-due-time" hint="optional">
              Due time
            </Label>
            <Input
              id="task-due-time"
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="task-energy">Energy</Label>
            <Select
              id="task-energy"
              value={energy}
              onChange={(e) => setEnergy(e.target.value as Task['energy'])}
              className="mt-1"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="task-priority">Priority</Label>
            <Select
              id="task-priority"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="mt-1"
            >
              <option value={1}>P1 — must</option>
              <option value={2}>P2 — should</option>
              <option value={3}>P3 — could</option>
            </Select>
          </div>
        </div>

        <fieldset>
          <legend className="text-[13px] font-medium text-ink">Waits on</legend>
          <p className="text-[12px] text-ink-faint">
            Tasks in the same project that must finish first.
          </p>
          <div className="mt-2 flex flex-col gap-1.5" data-testid="dependency-picker">
            {siblings.length === 0 ? (
              <p className="text-[13px] text-ink-faint">No other tasks here yet.</p>
            ) : null}
            {siblings.map((t) => {
              const checked = dependsOn.includes(t.id);
              const cycle = !checked && wouldCreateCycle(task.id, [...dependsOn, t.id], tasks);
              return (
                <Checkbox
                  key={t.id}
                  label={t.title}
                  description={
                    cycle
                      ? 'Would create a loop: that task already waits on this one.'
                      : t.status === 'done'
                        ? 'Done'
                        : undefined
                  }
                  checked={checked}
                  disabled={cycle}
                  onCheckedChange={(v) =>
                    setDependsOn((d) => (v === true ? [...d, t.id] : d.filter((x) => x !== t.id)))
                  }
                />
              );
            })}
          </div>
        </fieldset>

        <div>
          <Label htmlFor="task-notes">Notes</Label>
          <Textarea
            id="task-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1"
            rows={4}
          />
        </div>
        <FieldError>{error ?? undefined}</FieldError>
      </DrawerBody>
      <DrawerFooter className="justify-between">
        <Button
          variant="ghost"
          onClick={async () => {
            await archiveTask(repo, task);
            toast({ title: 'Task archived', description: task.title });
            onClose();
          }}
        >
          Archive
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            loading={saving}
            disabled={!!estimateError}
          >
            Save
          </Button>
        </div>
      </DrawerFooter>
    </>
  );
}
