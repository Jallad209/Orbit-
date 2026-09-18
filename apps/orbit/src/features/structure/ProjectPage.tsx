import { blockers, formatDuration, systemClock } from '@orbit/core';
import type { Clock, EntityRef, Milestone, Project, Task } from '@orbit/core';
import { ArrowDown, ArrowUp, Plus, Trash2, Unlink } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { HealthBadges } from '@/components/HealthBadge';
import { LinkPicker } from '@/components/LinkPicker';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ProgressBar, SectionHeader } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { InlineEdit } from '@/components/ui/InlineEdit';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { List, ListRow } from '@/components/ui/List';
import { useRepoQuery } from '@/data/useQuery';
import { useRepository } from '@/platform';
import { CompleteTaskDialog } from '@/features/timer/CompleteTaskDialog';
import {
  addLink,
  addMilestone,
  archiveProject,
  createTask,
  loadLinked,
  moveMilestone,
  removeLink,
  removeMilestone,
  renameMilestone,
  reopenTask,
  setNextAction,
  toggleMilestone,
  updateProject,
} from './structureService';
import { TaskEditor } from './TaskEditor';
import { useStructure } from './useStructure';

export interface ProjectPageProps {
  clock?: Clock;
}

/** One project: outcome, deadline, milestones, next action, tasks, and everything linked to it. */
export function ProjectPage({ clock = systemClock }: ProjectPageProps) {
  const { id } = useParams();
  const repo = useRepository();
  const { data } = useStructure(clock);
  const ref: EntityRef | null = id ? { type: 'project', id } : null;
  const { data: linked } = useRepoQuery(
    (r) => (ref ? loadLinked(r, ref) : Promise.resolve(null)),
    [id],
  );
  const [newMilestone, setNewMilestone] = useState('');
  const [newTask, setNewTask] = useState('');
  const [editing, setEditing] = useState<Task | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [completing, setCompleting] = useState<Task | null>(null);

  const project = data?.projects.find((p) => p.id === id);
  if (!data) return null;
  if (!project || !ref) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-display font-semibold">Project not found</h1>
        <Link to="/projects" className="underline">
          Back to projects
        </Link>
      </div>
    );
  }

  const health = data.health.get(project.id);
  const area = data.areas.find((a) => a.id === project.areaId);
  const goal = project.goalId ? data.goals.find((g) => g.id === project.goalId) : undefined;
  const milestones = data.milestones
    .filter((m) => m.projectId === project.id)
    .sort((a, b) => a.order - b.order);
  const tasks = data.tasks.filter((t) => t.projectId === project.id && t.status !== 'archived');
  const openTasks = tasks.filter((t) => t.status !== 'done');
  const shownTasks = showDone ? tasks : openTasks;
  const goalsInArea = data.goals.filter((g) => g.areaId === project.areaId);

  const addMs = async (e: FormEvent) => {
    e.preventDefault();
    if (!newMilestone.trim()) return;
    await addMilestone(repo, project.id, newMilestone.trim(), clock);
    setNewMilestone('');
  };

  const addTask = async (e: FormEvent) => {
    e.preventDefault();
    if (!newTask.trim()) return;
    const t = await createTask(repo, { title: newTask.trim(), projectId: project.id }, clock);
    setNewTask('');
    if (!project.nextActionTaskId && openTasks.length === 0)
      await setNextAction(repo, project, t.id);
  };

  const onStatus = async (status: Project['status']) => {
    if (status === 'archived') await archiveProject(repo, project);
    else await updateProject(repo, project, { status });
  };

  const alreadyLinked: EntityRef[] = linked
    ? [
        ...linked.notes.map((n) => ({ type: 'note' as const, id: n.id })),
        ...linked.people.map((p) => ({ type: 'person' as const, id: p.id })),
        ...linked.events.map((e) => ({ type: 'event' as const, id: e.id })),
        ...linked.bills.map((b) => ({ type: 'bill' as const, id: b.id })),
        ...linked.tasks.map((t) => ({ type: 'task' as const, id: t.id })),
      ]
    : [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link to="/projects" className="text-[13px] text-ink-muted hover:underline">
          ← Projects
        </Link>
        <h1 className="mt-1 text-display font-semibold tracking-tight text-ink">
          <InlineEdit
            value={project.title}
            onCommit={(v) => void updateProject(repo, project, { title: v })}
            aria-label="Project title"
          />
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-ink-muted">
          <span>
            {area?.name}
            {goal ? ` › ${goal.title}` : ''}
          </span>
          <HealthBadges health={health} />
        </p>
      </div>

      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-48">
            <ProgressBar value={health?.progress ?? 0} size="md" label="Project progress" />
          </div>
          <span className="text-[13px] text-ink-muted tnum" data-testid="progress-label">
            {Math.round((health?.progress ?? 0) * 100)}%
            {health?.progressSource === 'milestones'
              ? ` · ${health.milestonesDone}/${health.milestonesTotal} milestones`
              : health?.progressSource === 'tasks'
                ? ` · ${health.doneTasks}/${health.doneTasks + health.openTasks} tasks`
                : ''}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <Label htmlFor="project-status">Status</Label>
            <Select
              id="project-status"
              value={project.status}
              onChange={(e) => void onStatus(e.target.value as Project['status'])}
              className="mt-1"
            >
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="project-deadline">Deadline</Label>
            <Input
              id="project-deadline"
              type="date"
              value={project.deadline ?? ''}
              onChange={(e) =>
                void updateProject(repo, project, { deadline: e.target.value || null })
              }
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="project-goal">Goal</Label>
            <Select
              id="project-goal"
              value={project.goalId ?? ''}
              onChange={(e) =>
                void updateProject(repo, project, { goalId: e.target.value || null })
              }
              className="mt-1"
            >
              <option value="">No goal</option>
              {goalsInArea.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="project-next">Next action</Label>
            <Select
              id="project-next"
              value={
                project.nextActionTaskId && openTasks.some((t) => t.id === project.nextActionTaskId)
                  ? project.nextActionTaskId
                  : ''
              }
              onChange={(e) => void setNextAction(repo, project, e.target.value || null)}
              invalid={health?.noNextAction}
              className="mt-1"
            >
              <option value="">{openTasks.length ? 'Choose…' : 'No open tasks'}</option>
              {openTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="project-outcome">Desired outcome</Label>
          <Textarea
            id="project-outcome"
            defaultValue={project.outcome}
            placeholder="What is true when this project is done?"
            onBlur={(e) => {
              if (e.target.value !== project.outcome)
                void updateProject(repo, project, { outcome: e.target.value });
            }}
            className="mt-1"
            rows={2}
          />
        </div>
      </Card>

      <section aria-label="Milestones">
        <SectionHeader
          title="Milestones"
          meta={health ? `${health.milestonesDone}/${health.milestonesTotal}` : undefined}
        />
        <ul className="flex flex-col gap-1" data-testid="milestones">
          {milestones.map((m, i) => (
            <li
              key={m.id}
              className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-2"
            >
              <Checkbox
                aria-label={`${m.title} done`}
                checked={m.done}
                onCheckedChange={() => void toggleMilestone(repo, m)}
              />
              <div
                className={`min-w-0 flex-1 text-sm ${m.done ? 'text-ink-faint line-through' : ''}`}
              >
                <InlineEdit
                  value={m.title}
                  onCommit={(v) => void renameMilestone(repo, m, v)}
                  aria-label={`Milestone ${m.title}`}
                />
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Move ${m.title} up`}
                disabled={i === 0}
                onClick={() => void moveMilestone(repo, m, -1)}
              >
                <ArrowUp className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Move ${m.title} down`}
                disabled={i === milestones.length - 1}
                onClick={() => void moveMilestone(repo, m, 1)}
              >
                <ArrowDown className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${m.title}`}
                onClick={() => void removeMilestone(repo, m)}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
        <form onSubmit={addMs} className="mt-2 flex gap-2" aria-label="New milestone">
          <Input
            aria-label="Milestone title"
            placeholder="Add a milestone"
            value={newMilestone}
            onChange={(e) => setNewMilestone(e.target.value)}
            className="h-8"
          />
          <Button type="submit" size="sm" disabled={!newMilestone.trim()}>
            <Plus className="size-3.5" aria-hidden="true" /> Add
          </Button>
        </form>
      </section>

      <section aria-label="Tasks">
        <SectionHeader
          title="Tasks"
          meta={`${openTasks.length} open`}
          actions={
            <Button size="sm" variant="ghost" onClick={() => setShowDone((v) => !v)}>
              {showDone ? 'Hide done' : `Show done (${tasks.length - openTasks.length})`}
            </Button>
          }
        />
        {shownTasks.length === 0 ? (
          <EmptyState
            title="No tasks"
            description="Add the very next physical action."
            className="py-6"
          />
        ) : (
          <List
            aria-label="Project tasks"
            role="list"
            onActivate={(tid) => setEditing(tasks.find((t) => t.id === tid) ?? null)}
            className="rounded-lg border border-line bg-surface-2/40 p-1.5"
          >
            {shownTasks.map((t) => {
              const waits = blockers(t, data.tasks);
              return (
                <ListRow
                  key={t.id}
                  id={t.id}
                  role="listitem"
                  onActivate={() => setEditing(t)}
                  leading={
                    <Checkbox
                      aria-label={`Complete ${t.title}`}
                      checked={t.status === 'done'}
                      onCheckedChange={(v) =>
                        v === true ? setCompleting(t) : void reopenTask(repo, t)
                      }
                    />
                  }
                  trailing={
                    <>
                      {project.nextActionTaskId === t.id ? <Badge tone="lime">Next</Badge> : null}
                      {waits.length ? (
                        <Badge
                          tone="danger"
                          title={`Waits on ${waits.map((w) => w.title).join(', ')}`}
                        >
                          Waits on {waits.length}
                        </Badge>
                      ) : null}
                      {t.dueAt ? <Badge tone="outline">{t.dueAt.slice(0, 10)}</Badge> : null}
                      <Badge tone="outline">{formatDuration(t.estimateMin)}</Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(t)}
                        aria-label={`Edit ${t.title}`}
                      >
                        Edit
                      </Button>
                    </>
                  }
                >
                  <span className={t.status === 'done' ? 'text-ink-faint line-through' : ''}>
                    {t.title}
                  </span>
                </ListRow>
              );
            })}
          </List>
        )}
        <form onSubmit={addTask} className="mt-2 flex gap-2" aria-label="New task">
          <Input
            aria-label="Task title"
            placeholder="Add a task"
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            className="h-8"
          />
          <Button type="submit" size="sm" disabled={!newTask.trim()}>
            <Plus className="size-3.5" aria-hidden="true" /> Add
          </Button>
        </form>
      </section>

      <section aria-label="Linked">
        <SectionHeader
          title="Linked"
          actions={
            <LinkPicker
              from={ref}
              exclude={alreadyLinked}
              onLink={async (to) => {
                await addLink(repo, ref, to, 'related', clock);
              }}
            />
          }
        />
        {linked && alreadyLinked.length + linked.notes.length === 0 ? (
          <p className="text-[13px] text-ink-faint">
            Nothing linked yet. Notes, people, events, and bills can all attach here.
          </p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          {linked?.notes.length ? (
            <LinkedGroup
              title="Notes"
              items={linked.notes.map((n) => ({ id: n.id, label: n.title, linkId: n.linkId }))}
              onUnlink={(l) => removeLink(repo, l)}
            />
          ) : null}
          {linked?.people.length ? (
            <LinkedGroup
              title="People"
              items={linked.people.map((p) => ({ id: p.id, label: p.name, linkId: p.linkId }))}
              onUnlink={(l) => removeLink(repo, l)}
            />
          ) : null}
          {linked?.events.length ? (
            <LinkedGroup
              title="Events"
              items={linked.events.map((e) => ({
                id: e.id,
                label: e.title,
                hint: e.startAt.slice(0, 10),
                linkId: e.linkId,
              }))}
              onUnlink={(l) => removeLink(repo, l)}
            />
          ) : null}
          {linked?.bills.length ? (
            <LinkedGroup
              title="Bills"
              items={linked.bills.map((b) => ({
                id: b.id,
                label: b.title,
                hint: `${b.amount} ${b.currency}`.trim(),
                linkId: b.linkId,
              }))}
              onUnlink={(l) => removeLink(repo, l)}
            />
          ) : null}
          {linked?.tasks.length ? (
            <LinkedGroup
              title="Related tasks"
              items={linked.tasks.map((t) => ({ id: t.id, label: t.title, linkId: t.linkId }))}
              onUnlink={(l) => removeLink(repo, l)}
            />
          ) : null}
        </div>
      </section>

      <TaskEditor
        task={editing}
        tasks={data.tasks}
        projects={data.projects}
        onClose={() => setEditing(null)}
      />
      <CompleteTaskDialog task={completing} onClose={() => setCompleting(null)} clock={clock} />
    </div>
  );
}

function LinkedGroup({
  title,
  items,
  onUnlink,
}: {
  title: string;
  items: Array<{ id: string; label: string; hint?: string; linkId?: string }>;
  onUnlink: (linkId: string) => Promise<void>;
}) {
  return (
    <Card className="p-3">
      <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
        {title}
      </p>
      <ul className="flex flex-col gap-1" aria-label={`Linked ${title.toLowerCase()}`}>
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.hint ? <span className="text-[12px] text-ink-faint">{it.hint}</span> : null}
            {it.linkId ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Unlink ${it.label}`}
                onClick={() => void onUnlink(it.linkId!)}
              >
                <Unlink className="size-3.5" aria-hidden="true" />
              </Button>
            ) : (
              <Badge tone="outline">in project</Badge>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export type { Milestone };
