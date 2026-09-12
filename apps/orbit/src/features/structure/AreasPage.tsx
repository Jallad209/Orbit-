import { HierarchyError } from '@orbit/core';
import { Layers, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ProgressBar } from '@/components/ui/Card';
import { InlineEdit } from '@/components/ui/InlineEdit';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { useRepository } from '@/platform';
import { createArea, deleteArea, updateArea } from './structureService';
import { useStructure } from './useStructure';

function hours(min: number): string {
  return `${(min / 60).toFixed(1)}h`;
}

/** Areas of life with a weekly time target and how much attention each got in the last two weeks. */
export function AreasPage() {
  const repo = useRepository();
  const { data, loading } = useStructure();
  const [name, setName] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createArea(repo, { name: name.trim() });
    setName('');
  };

  const remove = async (id: string) => {
    try {
      await deleteArea(repo, id);
    } catch (err) {
      if (err instanceof HierarchyError) toast.warning('Area is not empty', err.message);
      else throw err;
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-display font-semibold tracking-tight text-ink">Areas</h1>
        <p className="mt-1 text-ink-muted">
          The parts of your life. Each one gets a weekly time target so Orbit can tell you what is
          being neglected.
        </p>
      </div>

      <form onSubmit={submit} className="flex gap-2" aria-label="New area">
        <Input
          aria-label="Area name"
          placeholder="New area, e.g. Health"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          Add area
        </Button>
      </form>

      {!loading && data && data.areas.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title="No areas yet"
          description="Start with three or four: Health, Work, Study, Home."
        />
      ) : null}

      <ul className="flex flex-col gap-2" aria-label="Areas">
        {data?.areas.map((area) => {
          const att = data.areaAttention.get(area.id);
          const goals = data.goals.filter(
            (g) => g.areaId === area.id && g.status === 'active',
          ).length;
          const projects = data.projects.filter(
            (p) => p.areaId === area.id && p.status === 'active',
          ).length;
          return (
            <li key={area.id}>
              <Card className="flex flex-col gap-3" data-testid={`area-${area.id}`}>
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="size-3 shrink-0 rounded-full"
                    style={{ background: area.color }}
                  />
                  <div className="min-w-0 flex-1 text-base font-medium">
                    <InlineEdit
                      value={area.name}
                      onCommit={(v) => void updateArea(repo, area, { name: v })}
                      aria-label={`Area name ${area.name}`}
                    />
                  </div>
                  <label className="flex items-center gap-1.5 text-[13px] text-ink-muted">
                    Target
                    <Input
                      type="number"
                      min={0}
                      max={168}
                      step={0.5}
                      aria-label={`Weekly hours target for ${area.name}`}
                      defaultValue={area.weeklyHoursTarget}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v !== area.weeklyHoursTarget)
                          void updateArea(repo, area, { weeklyHoursTarget: v });
                      }}
                      className="h-8 w-20 tnum"
                    />
                    h/week
                  </label>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${area.name}`}
                    onClick={() => void remove(area.id)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="flex items-center gap-3 text-[13px] text-ink-muted">
                  <div className="w-40">
                    <ProgressBar
                      value={att?.ratio ?? 0}
                      tone={att && att.ratio !== null && att.ratio < 0.5 ? 'gold' : 'lime'}
                      label={`Attention for ${area.name}`}
                    />
                  </div>
                  <span className="tnum">
                    {att ? hours(att.minutesInWindow) : '0h'} in 14 days
                    {att && att.targetMinutes > 0 ? ` of ${hours(att.targetMinutes)}` : ''}
                  </span>
                  <span className="ml-auto">
                    <Link to="/goals" className="hover:underline">
                      {goals} goals
                    </Link>{' '}
                    ·{' '}
                    <Link to="/projects" className="hover:underline">
                      {projects} projects
                    </Link>
                  </span>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
