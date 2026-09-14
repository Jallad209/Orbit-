import type { Goal, GoalAttention, ProjectHealth } from '@orbit/core';
import { Badge } from '@/components/ui/Badge';

/**
 * The neglect signals for a project, as compact chips. Renders nothing when
 * healthy. The stale chip carries the threshold it was judged against, the
 * same one the stale-project insight uses, so the two can never disagree.
 * A dismissed insight does not remove a chip: suppression hides cards, not
 * facts.
 */
export function HealthBadges({ health }: { health: ProjectHealth | undefined }) {
  if (!health) return null;
  const chips: Array<{
    key: string;
    tone: 'danger' | 'gold' | 'neutral';
    label: string;
    title?: string;
  }> = [];
  if (health.overdue)
    chips.push({ key: 'overdue', tone: 'danger', label: `Overdue ${-health.daysToDeadline!}d` });
  if (health.blocked) chips.push({ key: 'blocked', tone: 'danger', label: 'Blocked' });
  if (health.noNextAction) chips.push({ key: 'next', tone: 'gold', label: 'No next action' });
  if (health.stale)
    chips.push({
      key: 'stale',
      tone: 'neutral',
      label: `Stale ${health.staleDays}d`,
      title: `No recorded activity for ${health.staleDays} days; the threshold is ${health.staleAfterDays}.`,
    });
  if (!chips.length) return null;
  return (
    <span className="flex flex-wrap gap-1" data-testid="health-badges">
      {chips.map((c) => (
        <Badge key={c.key} tone={c.tone} data-health={c.key} title={c.title}>
          {c.label}
        </Badge>
      ))}
    </span>
  );
}

/**
 * A goal's attention as one chip: its status when not active, "Neglected"
 * when an active goal got no time in the window, else the hours recorded.
 * One vocabulary for the goals list, the goal page, and any card.
 */
export function GoalHealthBadge({
  goal,
  attention,
  windowDays = 14,
}: {
  goal: Goal;
  attention: GoalAttention | undefined;
  windowDays?: number;
}) {
  if (goal.status !== 'active') return <Badge tone="outline">{goal.status}</Badge>;
  if (attention?.neglected)
    return (
      <Badge
        tone="gold"
        data-neglected="true"
        title={`No time recorded on this goal in the last ${windowDays} days`}
      >
        Neglected
      </Badge>
    );
  return (
    <Badge tone="ok">
      {((attention?.minutesInWindow ?? 0) / 60).toFixed(1)}h / {windowDays}d
    </Badge>
  );
}
