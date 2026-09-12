import { FolderKanban } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { HealthBadges } from '@/components/HealthBadge';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ProgressBar } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Checkbox';
import { useRepository } from '@/platform';
import { createProject } from './structureService';
import { useStructure } from './useStructure';

/** Every project with its progress and neglect signals. */
export function ProjectsPage() {
  const repo = useRepository();
  const { data, loading } = useStructure();
  const [title, setTitle] = useState('');
  const [areaId, setAreaId] = useState('');
  const [goalId, setGoalId] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const effectiveArea = areaId || data?.areas[0]?.id || '';
  const goalsInArea =
    data?.goals.filter((g) => g.areaId === effectiveArea && g.status === 'active') ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !effectiveArea) return;
    await createProject(repo, {
      title: title.trim(),
      areaId: effectiveArea,
      goalId: goalId || null,
    });
    setTitle('');
  };

  const projects = (data?.projects ?? [])
    .filter((p) => showArchived || p.status !== 'archived')
    .sort((a, b) =>
      a.status === b.status ? a.title.localeCompare(b.title) : a.status === 'active' ? -1 : 1,
    );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-display font-semibold tracking-tight text-ink">Projects</h1>
        <p className="mt-1 text-ink-muted">
          Outcomes with a deadline and a next action. Orbit flags the ones that have stopped moving.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-wrap gap-2" aria-label="New project">
        <Input
          aria-label="Project title"
          placeholder="New project, e.g. Thesis"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-w-56 flex-1"
        />
        <Select
          aria-label="Area"
          value={effectiveArea}
          onChange={(e) => {
            setAreaId(e.target.value);
            setGoalId('');
          }}
          className="w-40"
        >
          {data?.areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Goal"
          value={goalId}
          onChange={(e) => setGoalId(e.target.value)}
          className="w-44"
        >
          <option value="">No goal</option>
          {goalsInArea.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="primary" disabled={!title.trim() || !effectiveArea}>
          Add project
        </Button>
      </form>

      <div className="flex items-center justify-between text-[13px] text-ink-muted">
        <span>{projects.length} shown</span>
        <div className="w-44">
          <Toggle label="Show archived" checked={showArchived} onCheckedChange={setShowArchived} />
        </div>
      </div>

      {!loading && data && data.areas.length === 0 ? (
        <p className="text-[13px] text-ink-muted">
          Create an{' '}
          <Link to="/areas" className="underline">
            area
          </Link>{' '}
          first; every project belongs to one.
        </p>
      ) : null}
      {!loading && projects.length === 0 && data && data.areas.length > 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          title="No projects yet"
          description="A project is anything that takes more than one sitting."
        />
      ) : null}

      <ul className="flex flex-col gap-1.5" aria-label="Projects">
        {projects.map((p) => {
          const h = data?.health.get(p.id);
          const area = data?.areas.find((a) => a.id === p.areaId);
          const goal = p.goalId ? data?.goals.find((g) => g.id === p.goalId) : undefined;
          return (
            <li key={p.id}>
              <Link
                to={`/projects/${p.id}`}
                data-testid={`project-${p.id}`}
                className="flex items-center gap-3 rounded-md border border-line bg-surface-2/50 px-3 py-2.5 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-lime-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.title}</div>
                  <div className="truncate text-[12px] text-ink-faint">
                    {area?.name}
                    {goal ? ` › ${goal.title}` : ''}
                    {p.deadline ? ` · due ${p.deadline}` : ''}
                  </div>
                </div>
                <HealthBadges health={h} />
                <div className="w-28">
                  <ProgressBar value={h?.progress ?? 0} label={`${p.title} progress`} />
                </div>
                <span className="w-10 text-right text-[12px] text-ink-faint tnum">
                  {Math.round((h?.progress ?? 0) * 100)}%
                </span>
                {p.status !== 'active' ? <Badge tone="outline">{p.status}</Badge> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
