import { systemClock } from '@orbit/core';
import type { Clock } from '@orbit/core';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Card';
import { routeFor } from '@/lib/destinations';
import { TaskEditor } from './TaskEditor';
import { useStructure } from './useStructure';

/**
 * `/tasks/:id` (week 12): the existing task editor wrapped in a real
 * route, so a search result, a piece of evidence, a Markdown link, or a
 * notification can open a task by address. Closing the drawer returns to
 * the task's project when it has one, else to Today. A missing or deleted
 * task shows a safe state rather than an empty editor.
 */
export function TaskPage({ clock = systemClock }: { clock?: Clock }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading } = useStructure(clock);
  if (!data) return loading ? <p className="text-sm text-ink-muted">Loading…</p> : null;
  const task = data.tasks.find((t) => t.id === id);
  if (!task) {
    return (
      <EmptyState
        title="That task no longer exists"
        description="It was deleted, or the link came from data that is no longer here."
        action={
          <Link to="/projects" className="text-sm underline">
            Open projects
          </Link>
        }
      />
    );
  }
  const project = task.projectId ? data.projects.find((p) => p.id === task.projectId) : undefined;
  const back = project ? routeFor({ type: 'project', id: project.id })! : '/today';
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-testid="task-page">
      <Link to={back} className="text-[13px] text-ink-muted hover:underline">
        ← {project ? project.title : 'Today'}
      </Link>
      <h1 className="text-display font-semibold tracking-tight text-ink">{task.title}</h1>
      <p className="flex flex-wrap gap-2 text-ink-muted">
        <Badge tone="outline">{task.status}</Badge>
        {task.dueAt ? <Badge tone="outline">due {task.dueAt.slice(0, 10)}</Badge> : null}
      </p>
      <TaskEditor
        task={task}
        tasks={data.tasks}
        projects={data.projects}
        onClose={() => void navigate(back)}
      />
    </div>
  );
}
