import { toLocalDate, minuteOfDay } from '../dates';
import type { Energy, Id, LocalDate, Project, Task } from '../schema';
import { fixedRefs } from './capacity';
import type { Candidate, LeftOut, PlanSettings, PlanSnapshot } from './types';

const ENERGY_RANK: Record<Energy, number> = { low: 0, medium: 1, high: 2 };
const DAY_MS = 86_400_000;

export function energyGap(candidate: Energy, day: Energy): number {
  return ENERGY_RANK[candidate] - ENERGY_RANK[day];
}

function daysBetween(fromIso: string, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - new Date(fromIso).getTime()) / DAY_MS));
}

export interface CandidateSet {
  candidates: Candidate[];
  leftOut: LeftOut[];
}

/**
 * Open, ready, energy-compatible tasks plus today's planned routine
 * instances. Everything that fails a constraint is returned in `leftOut`
 * with the reason, so the proposal can show it.
 */
export function selectCandidates(
  snapshot: PlanSnapshot,
  date: LocalDate,
  settings: PlanSettings,
  now: Date,
): CandidateSet {
  const candidates: Candidate[] = [];
  const leftOut: LeftOut[] = [];
  const projects = new Map<Id, Project>(
    snapshot.projects.filter((p) => p.deletedAt === null).map((p) => [p.id, p]),
  );
  const fixed = fixedRefs(snapshot, date);
  // One map for every readiness check; `blockers()` would rebuild it per task.
  const liveTasks = new Map<Id, Task>(
    snapshot.tasks.filter((t) => t.deletedAt === null).map((t) => [t.id, t]),
  );
  const excluded = new Set(settings.excludeTaskIds);
  const only = settings.candidateIds ? new Set(settings.candidateIds) : null;

  const lastSession = new Map<Id, string>();
  for (const s of snapshot.sessions ?? []) {
    if (s.deletedAt !== null) continue;
    const at = s.endAt ?? s.startAt;
    const cur = lastSession.get(s.taskId);
    if (!cur || at > cur) lastSession.set(s.taskId, at);
  }

  for (const t of snapshot.tasks) {
    if (t.deletedAt !== null || t.status !== 'open') continue;
    const project = t.projectId ? projects.get(t.projectId) : undefined;
    if (t.projectId && (!project || project.status !== 'active')) continue;
    if (only && !only.has(t.id)) continue;

    if (excluded.has(t.id)) {
      leftOut.push(left('task', t, 'user', 'Removed from today by you'));
      continue;
    }
    if (fixed.has(t.id)) {
      leftOut.push(left('task', t, 'scheduled', 'Already on today’s timeline'));
      continue;
    }
    const waits = t.dependsOn
      .map((id) => liveTasks.get(id))
      .filter((d): d is Task => !!d && d.status !== 'done' && d.status !== 'archived');
    if (waits.length) {
      const names = waits.map((w) => `“${w.title}”`).join(', ');
      leftOut.push(left('task', t, 'blocked', `Waits on ${names}`));
      continue;
    }
    if (energyGap(t.energy, settings.energy) >= 2) {
      leftOut.push(
        left('task', t, 'energy', `Needs ${t.energy} energy on a ${settings.energy}-energy day`),
      );
      continue;
    }

    // A preferred day is an explicit assignment, not a recurring suggestion. An unfinished task
    // only moves to another day through rollover or an edit. A preferred start remains a placement
    // hint rather than a hard reservation, so conflicts can still be resolved transparently.
    if (t.preferredDate && t.preferredDate !== date) continue;

    let dueDate: LocalDate | null = null;
    let dueSource: Candidate['dueSource'] = null;
    let dueMin: number | null = null;
    if (t.dueAt) {
      const d = new Date(t.dueAt);
      dueDate = toLocalDate(d);
      dueSource = 'task';
      const m = minuteOfDay(d);
      if (dueDate === date && m > 0) dueMin = m;
    } else if (project?.deadline) {
      dueDate = project.deadline;
      dueSource = 'project';
    }

    const touched = lastSession.get(t.id);
    const latest = touched && touched > t.updatedAt ? touched : t.updatedAt;

    candidates.push({
      kind: 'task',
      id: t.id,
      title: t.title,
      durationMin: t.estimateMin,
      energy: t.energy,
      areaId: t.areaId ?? project?.areaId ?? null,
      projectId: t.projectId,
      goalId: project?.goalId ?? null,
      priority: t.priority,
      dueDate,
      dueSource,
      dueMin,
      preferredWindow:
        t.preferredDate === date && t.preferredStartMin !== null
          ? {
              startMin: t.preferredStartMin,
              endMin: Math.min(1440, t.preferredStartMin + t.estimateMin),
            }
          : null,
      isNextAction: project?.nextActionTaskId === t.id,
      untouchedDays: daysBetween(latest, now),
      createdAt: t.createdAt,
    });
  }

  const routines = new Map(
    (snapshot.routines ?? []).filter((r) => r.deletedAt === null).map((r) => [r.id, r]),
  );
  for (const inst of snapshot.routineInstances ?? []) {
    if (inst.deletedAt !== null || inst.date !== date || inst.status !== 'planned') continue;
    const routine = routines.get(inst.routineId);
    if (!routine) continue;
    if (only && !only.has(inst.id)) continue;
    if (fixed.has(inst.id)) {
      leftOut.push({
        kind: 'routine',
        id: inst.id,
        title: routine.title,
        reason: 'scheduled',
        detail: 'Already on today’s timeline',
        score: null,
      });
      continue;
    }
    if (energyGap(routine.energy, settings.energy) >= 2) {
      leftOut.push({
        kind: 'routine',
        id: inst.id,
        title: routine.title,
        reason: 'energy',
        detail: `Needs ${routine.energy} energy on a ${settings.energy}-energy day`,
        score: null,
      });
      continue;
    }
    candidates.push({
      kind: 'routine',
      id: inst.id,
      title: routine.title,
      durationMin: routine.durationMin,
      energy: routine.energy,
      areaId: routine.areaId,
      projectId: null,
      goalId: null,
      priority: 2,
      dueDate: date,
      dueSource: null,
      dueMin: null,
      preferredWindow: routine.preferredWindow,
      isNextAction: false,
      untouchedDays: 0,
      createdAt: inst.createdAt,
    });
  }

  return { candidates, leftOut };
}

function left(kind: 'task', t: Task, reason: LeftOut['reason'], detail: string): LeftOut {
  return { kind, id: t.id, title: t.title, reason, detail, score: null };
}
