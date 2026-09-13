import type { Goal, Id, Project } from '../schema';
import type { Placement } from './fill';
import type { Scored } from './score';
import type { PlanSettings, Why } from './types';

export interface ExplainContext {
  goals: ReadonlyMap<Id, Goal>;
  projects: ReadonlyMap<Id, Project>;
  settings: PlanSettings;
}

/** Plain-language reasons in the order a person would give them. */
export function reasonsFor(s: Scored, ctx: ExplainContext): string[] {
  const c = s.candidate;
  const out: string[] = [];
  if (c.kind === 'routine') {
    out.push('Routine due today');
  } else {
    const d = s.daysToDue;
    const what = c.dueSource === 'project' ? 'Project deadline' : 'Due';
    if (d === null) out.push('No due date');
    else if (d < 0) out.push(`${what} ${-d} day${-d === 1 ? '' : 's'} ago`);
    else if (d === 0) out.push(`${what} today`);
    else if (d === 1) out.push(`${what} tomorrow`);
    else if (d <= 14) out.push(`${what} in ${d} days`);
    else out.push(`${what} ${c.dueDate}`);

    const goal = c.goalId ? ctx.goals.get(c.goalId) : undefined;
    if (goal) out.push(`Goal “${goal.title}” is importance ${goal.importance}/5`);

    if (c.isNextAction) {
      const project = c.projectId ? ctx.projects.get(c.projectId) : undefined;
      out.push(`Next action for “${project?.title ?? 'its project'}”`);
    }
    if (c.priority === 1) out.push('Priority 1');
    else if (c.priority === 3) out.push('Priority 3, the lowest');
    if (c.untouchedDays >= 3) out.push(`Untouched for ${c.untouchedDays} days`);
  }

  const fit = s.components.energyFit;
  const day = ctx.settings.energy;
  if (fit === 1) out.push(`Matches a ${day}-energy day`);
  else if (fit >= 0.8) out.push(`Easy fit for a ${day}-energy day`);
  else out.push(`Needs more energy than today has, so scored down`);
  return out;
}

export function explain(p: Placement, ctx: ExplainContext): Why {
  return {
    score: p.scored.score,
    components: p.scored.components,
    reasons: reasonsFor(p.scored, ctx),
    placedAt: p.parts,
  };
}
