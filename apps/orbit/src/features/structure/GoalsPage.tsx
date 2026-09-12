import type { Goal } from '@orbit/core';
import { Target } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ProgressBar, SectionHeader } from '@/components/ui/Card';
import { InlineEdit } from '@/components/ui/InlineEdit';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { useRepository } from '@/platform';
import { createGoal, createProject, updateGoal } from './structureService';
import { useStructure } from './useStructure';

function Importance({ value }: { value: number }) {
  return (
    <span
      aria-label={`Importance ${value} of 5`}
      title={`Importance ${value}/5`}
      className="inline-flex gap-0.5"
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`size-1.5 rounded-full ${i <= value ? 'bg-gold' : 'bg-surface-3'}`}
        />
      ))}
    </span>
  );
}

function NeglectBadge({
  goal,
  minutes,
  neglected,
}: {
  goal: Goal;
  minutes: number;
  neglected: boolean;
}) {
  if (goal.status !== 'active') return <Badge tone="outline">{goal.status}</Badge>;
  if (neglected)
    return (
      <Badge
        tone="gold"
        data-neglected="true"
        title="No time recorded on this goal in the last 14 days"
      >
        Neglected
      </Badge>
    );
  return <Badge tone="ok">{(minutes / 60).toFixed(1)}h / 14d</Badge>;
}

/** Goals grouped by area, with importance and whether they are getting any time. */
export function GoalsPage() {
  const repo = useRepository();
  const { data, loading } = useStructure();
  const [title, setTitle] = useState('');
  const [areaId, setAreaId] = useState('');
  const [importance, setImportance] = useState(3);

  const effectiveArea = areaId || data?.areas[0]?.id || '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !effectiveArea) return;
    await createGoal(repo, { title: title.trim(), areaId: effectiveArea, importance });
    setTitle('');
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-display font-semibold tracking-tight text-ink">Goals</h1>
        <p className="mt-1 text-ink-muted">
          Outcomes worth weeks or months. Projects advance them; the planner weighs tasks by their
          importance.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-wrap gap-2" aria-label="New goal">
        <Input
          aria-label="Goal title"
          placeholder="New goal, e.g. Run a half marathon"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-w-56 flex-1"
        />
        <Select
          aria-label="Area"
          value={effectiveArea}
          onChange={(e) => setAreaId(e.target.value)}
          className="w-40"
        >
          {data?.areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Importance"
          value={importance}
          onChange={(e) => setImportance(Number(e.target.value))}
          className="w-36"
        >
          {[5, 4, 3, 2, 1].map((i) => (
            <option key={i} value={i}>
              Importance {i}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="primary" disabled={!title.trim() || !effectiveArea}>
          Add goal
        </Button>
      </form>

      {!loading && data && data.areas.length === 0 ? (
        <p className="text-[13px] text-ink-muted">
          Create an{' '}
          <Link to="/areas" className="underline">
            area
          </Link>{' '}
          first; every goal belongs to one.
        </p>
      ) : null}
      {!loading && data && data.areas.length > 0 && data.goals.length === 0 ? (
        <EmptyState
          icon={<Target />}
          title="No goals yet"
          description="What would make the next three months a success?"
        />
      ) : null}

      {data?.areas.map((area) => {
        const goals = data.goals.filter((g) => g.areaId === area.id);
        if (!goals.length) return null;
        return (
          <section key={area.id} aria-label={area.name}>
            <SectionHeader title={area.name} meta={`${goals.length}`} />
            <ul className="flex flex-col gap-1.5">
              {goals.map((g) => {
                const att = data.goalAttention.get(g.id);
                const projects = data.projects.filter(
                  (p) => p.goalId === g.id && p.status === 'active',
                ).length;
                return (
                  <li key={g.id}>
                    <Link
                      to={`/goals/${g.id}`}
                      className="flex items-center gap-3 rounded-md border border-line bg-surface-2/50 px-3 py-2.5 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-lime-2"
                    >
                      <Importance value={g.importance} />
                      <span className="min-w-0 flex-1 truncate font-medium">{g.title}</span>
                      {g.targetDate ? (
                        <span className="text-[12px] text-ink-faint tnum">by {g.targetDate}</span>
                      ) : null}
                      <span className="text-[12px] text-ink-faint">{projects} projects</span>
                      <NeglectBadge
                        goal={g}
                        minutes={att?.minutesInWindow ?? 0}
                        neglected={att?.neglected ?? false}
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** One goal: fields, attention, and the projects advancing it. */
export function GoalPage() {
  const { id } = useParams();
  const repo = useRepository();
  const navigate = useNavigate();
  const { data } = useStructure();
  const [projectTitle, setProjectTitle] = useState('');

  const goal = data?.goals.find((g) => g.id === id);
  if (!data) return null;
  if (!goal) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-display font-semibold">Goal not found</h1>
        <Link to="/goals" className="underline">
          Back to goals
        </Link>
      </div>
    );
  }
  const att = data.goalAttention.get(goal.id);
  const area = data.areas.find((a) => a.id === goal.areaId);
  const projects = data.projects.filter((p) => p.goalId === goal.id);

  const addProject = async (e: FormEvent) => {
    e.preventDefault();
    if (!projectTitle.trim()) return;
    const p = await createProject(repo, {
      title: projectTitle.trim(),
      areaId: goal.areaId,
      goalId: goal.id,
    });
    setProjectTitle('');
    navigate(`/projects/${p.id}`);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link to="/goals" className="text-[13px] text-ink-muted hover:underline">
          ← Goals
        </Link>
        <h1 className="mt-1 text-display font-semibold tracking-tight text-ink">
          <InlineEdit
            value={goal.title}
            onCommit={(v) => void updateGoal(repo, goal, { title: v })}
            aria-label="Goal title"
          />
        </h1>
        <p className="mt-1 text-ink-muted">{area?.name}</p>
      </div>

      <Card className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <Label htmlFor="goal-importance">Importance</Label>
          <Select
            id="goal-importance"
            value={goal.importance}
            onChange={(e) => void updateGoal(repo, goal, { importance: Number(e.target.value) })}
            className="mt-1"
          >
            {[5, 4, 3, 2, 1].map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="goal-date">Target date</Label>
          <Input
            id="goal-date"
            type="date"
            value={goal.targetDate ?? ''}
            onChange={(e) => void updateGoal(repo, goal, { targetDate: e.target.value || null })}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="goal-status">Status</Label>
          <Select
            id="goal-status"
            value={goal.status}
            onChange={(e) =>
              void updateGoal(repo, goal, { status: e.target.value as Goal['status'] })
            }
            className="mt-1"
          >
            <option value="active">Active</option>
            <option value="achieved">Achieved</option>
            <option value="dropped">Dropped</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="goal-area">Area</Label>
          <Select
            id="goal-area"
            value={goal.areaId}
            onChange={(e) => void updateGoal(repo, goal, { areaId: e.target.value })}
            className="mt-1"
          >
            {data.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <Card>
        <SectionHeader title="Attention" meta="last 14 days" />
        <div className="flex items-center gap-3">
          <div className="w-48">
            <ProgressBar
              value={att?.ratio ?? 0}
              tone={att?.neglected ? 'gold' : 'lime'}
              label="Goal attention"
            />
          </div>
          <span className="text-[13px] text-ink-muted tnum">
            {((att?.minutesInWindow ?? 0) / 60).toFixed(1)}h recorded
            {att?.expectedMinutes
              ? ` of ${(att.expectedMinutes / 60).toFixed(1)}h expected`
              : ' · set a weekly target on the area to get an expectation'}
          </span>
          {att?.neglected ? <Badge tone="gold">Neglected</Badge> : null}
        </div>
      </Card>

      <section aria-label="Projects">
        <SectionHeader title="Projects" meta={`${projects.length}`} />
        <ul className="flex flex-col gap-1.5">
          {projects.map((p) => {
            const h = data.health.get(p.id);
            return (
              <li key={p.id}>
                <Link
                  to={`/projects/${p.id}`}
                  className="flex items-center gap-3 rounded-md border border-line bg-surface-2/50 px-3 py-2.5 hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
                  <div className="w-28">
                    <ProgressBar value={h?.progress ?? 0} label={`${p.title} progress`} />
                  </div>
                  <Badge tone="outline">{p.status}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
        <form onSubmit={addProject} className="mt-2 flex gap-2" aria-label="New project for goal">
          <Input
            aria-label="Project title"
            placeholder="New project advancing this goal"
            value={projectTitle}
            onChange={(e) => setProjectTitle(e.target.value)}
          />
          <Button type="submit" disabled={!projectTitle.trim()}>
            Add project
          </Button>
        </form>
      </section>

      <Textarea
        aria-label="Notes"
        placeholder="Why this goal matters (optional)"
        className="hidden"
      />
    </div>
  );
}
