import type { Id, Task } from '../schema';

export type DependencyErrorCode = 'self' | 'cycle' | 'missing';

export class DependencyError extends Error {
  constructor(
    public readonly code: DependencyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DependencyError';
  }
}

function liveById(tasks: readonly Task[]): Map<Id, Task> {
  return new Map(tasks.filter((t) => t.deletedAt === null).map((t) => [t.id, t]));
}

/**
 * True when setting `dependsOn` on `taskId` would let a task reach itself.
 * Walks the existing graph from each proposed dependency.
 */
export function wouldCreateCycle(
  taskId: Id,
  dependsOn: readonly Id[],
  tasks: readonly Task[],
): boolean {
  const map = liveById(tasks);
  const seen = new Set<Id>();
  const stack = [...dependsOn];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = map.get(id);
    if (t) stack.push(...t.dependsOn);
  }
  return false;
}

/** Throws when the proposed dependency list is invalid. */
export function validateDependencies(
  taskId: Id,
  dependsOn: readonly Id[],
  tasks: readonly Task[],
): void {
  if (dependsOn.includes(taskId))
    throw new DependencyError('self', 'A task cannot depend on itself.');
  const map = liveById(tasks);
  const missing = dependsOn.find((id) => !map.has(id));
  if (missing) throw new DependencyError('missing', 'That task no longer exists.');
  if (wouldCreateCycle(taskId, dependsOn, tasks)) {
    throw new DependencyError(
      'cycle',
      'That would create a loop: the other task already waits on this one.',
    );
  }
}

/** Dependencies of `task` that are not done yet (missing ones are ignored). */
export function blockers(task: Task, tasks: readonly Task[]): Task[] {
  const map = liveById(tasks);
  return task.dependsOn
    .map((id) => map.get(id))
    .filter((t): t is Task => !!t && t.status !== 'done' && t.status !== 'archived');
}

/** A task is ready when every dependency is done (or gone). */
export function isReady(task: Task, tasks: readonly Task[]): boolean {
  return blockers(task, tasks).length === 0;
}

/** Tasks that depend on `taskId`, i.e. become closer to ready when it is done. */
export function dependents(taskId: Id, tasks: readonly Task[]): Task[] {
  return tasks.filter((t) => t.deletedAt === null && t.dependsOn.includes(taskId));
}
