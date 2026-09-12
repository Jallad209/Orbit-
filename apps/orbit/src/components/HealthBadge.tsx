import type { ProjectHealth } from '@orbit/core';
import { Badge } from '@/components/ui/Badge';

/** The neglect signals for a project, as compact chips. Renders nothing when healthy. */
export function HealthBadges({ health }: { health: ProjectHealth | undefined }) {
  if (!health) return null;
  const chips: Array<{ key: string; tone: 'danger' | 'gold' | 'neutral'; label: string }> = [];
  if (health.overdue)
    chips.push({ key: 'overdue', tone: 'danger', label: `Overdue ${-health.daysToDeadline!}d` });
  if (health.blocked) chips.push({ key: 'blocked', tone: 'danger', label: 'Blocked' });
  if (health.noNextAction) chips.push({ key: 'next', tone: 'gold', label: 'No next action' });
  if (health.stale)
    chips.push({ key: 'stale', tone: 'neutral', label: `Stale ${health.staleDays}d` });
  if (!chips.length) return null;
  return (
    <span className="flex flex-wrap gap-1" data-testid="health-badges">
      {chips.map((c) => (
        <Badge key={c.key} tone={c.tone} data-health={c.key}>
          {c.label}
        </Badge>
      ))}
    </span>
  );
}
