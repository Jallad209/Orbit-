import { z } from 'zod';
import { materializeCapture, parseCapture, reclassify } from '../capture';
import { toLocalDate } from '../dates';
import { applyRollover, rolloverDate, suggestRollover } from '../rules/rollover';
import { IdSchema, RolloverTargetSchema } from '../schema';
import type { BaseRecord, RolloverTarget, Task } from '../schema';
import { buildEvening } from '../services/evening';
import {
  COMMAND_STORES,
  storeFor,
  type CommandContext,
  type CommandDefinition,
  type CommandOutcome,
  type UndoChange,
  type UndoableEntity,
} from './types';

/**
 * The core commands: what the palette offers on every runtime. Each is a
 * plain definition — id, words, an argument schema, availability, and a
 * `run` that returns what changed so the undo stack can reverse it.
 */

const TextArgs = z.object({
  text: z.string().trim().min(1, 'Type something first.').max(500, 'Keep it under 500 characters.'),
});

const TYPE_LABEL: Record<'task' | 'note' | 'event', string> = {
  task: 'task',
  note: 'note',
  event: 'event',
};

/** The entity a materialized record belongs to, from its store name. */
function entityForStore(store: string): UndoableEntity {
  const hit = (Object.entries(COMMAND_STORES) as Array<[UndoableEntity, string]>).find(
    ([, name]) => name === store,
  );
  if (!hit) throw new Error(`No undoable entity for store "${store}"`);
  return hit[0];
}

/**
 * Capture-style creation: the text goes through the same parser and
 * materializer as the inbox, forced to the command's type, and every record
 * it produces is written in one transaction and recorded for undo.
 */
function createFromText(type: 'task' | 'note' | 'event') {
  return async (ctx: CommandContext, args: z.output<typeof TextArgs>): Promise<CommandOutcome> => {
    const captureCtx = {
      now: ctx.clock.now(),
      people: ctx.names?.people ?? [],
      projects: ctx.names?.projects ?? [],
    };
    const parsed = parseCapture(args.text, captureCtx);
    const result = parsed.type === type ? parsed : reclassify(parsed, type, captureCtx);
    const people = type === 'event' ? [] : await ctx.repo.people.list();
    const { records } = materializeCapture(type, result.fields, ctx.clock, {
      defaultEstimateMin: ctx.settings.defaultEstimateMin,
      people,
    });
    const changes: UndoChange[] = [];
    await ctx.repo.transaction(async (tx) => {
      for (const r of records) {
        const entity = entityForStore(r.store);
        const store = storeFor(tx, entity);
        const after = await store.upsert(r.record as BaseRecord);
        changes.push({ entity, entityId: after.id, before: null, after });
      }
    });
    const title = result.fields.title;
    return { message: `Added ${TYPE_LABEL[type]}`, detail: title, changes };
  };
}

export const addTask: CommandDefinition<typeof TextArgs> = {
  id: 'add-task',
  title: 'Add task',
  keywords: ['new', 'create', 'todo', 'capture'],
  group: 'Create',
  args: TextArgs,
  prompt: {
    kind: 'text',
    field: 'text',
    label: 'What needs doing?',
    placeholder: 'Submit report next Friday #thesis',
  },
  run: createFromText('task'),
};

export const addNote: CommandDefinition<typeof TextArgs> = {
  id: 'add-note',
  title: 'Add note',
  keywords: ['new', 'create', 'write', 'memo'],
  group: 'Create',
  args: TextArgs,
  prompt: { kind: 'text', field: 'text', label: 'Note title', placeholder: 'Reading list' },
  run: createFromText('note'),
};

export const addEvent: CommandDefinition<typeof TextArgs> = {
  id: 'add-event',
  title: 'Add event',
  keywords: ['new', 'create', 'meeting', 'calendar', 'appointment'],
  group: 'Create',
  args: TextArgs,
  prompt: {
    kind: 'text',
    field: 'text',
    label: 'What and when?',
    placeholder: 'Dentist tomorrow at 3pm',
  },
  run: createFromText('event'),
};

const OpenProjectArgs = z.object({ projectId: IdSchema });

export const openProject: CommandDefinition<typeof OpenProjectArgs> = {
  id: 'open-project',
  title: 'Open project',
  keywords: ['go', 'jump', 'show'],
  group: 'Navigate',
  args: OpenProjectArgs,
  prompt: {
    kind: 'choice',
    field: 'projectId',
    label: 'Which project?',
    choices: async (ctx) =>
      (await ctx.repo.projects.list())
        .filter((p) => p.status === 'active')
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((p) => ({ value: p.id, label: p.title, hint: p.status })),
  },
  async run(ctx, args) {
    const project = await ctx.repo.projects.get(args.projectId);
    if (!project || project.deletedAt !== null) {
      return { message: 'That project no longer exists.' };
    }
    ctx.navigate(`/projects/${project.id}`);
    return {};
  },
};

export const planMyDay: CommandDefinition = {
  id: 'plan-my-day',
  title: 'Plan my day',
  keywords: ['today', 'proposal', 'schedule', 'planner'],
  group: 'Plan',
  async run(ctx) {
    ctx.navigate('/today');
    return {};
  },
};

export const regeneratePlan: CommandDefinition = {
  id: 'regenerate-plan',
  title: "Regenerate today's proposal",
  keywords: ['replan', 're-plan', 'refresh', 'again', 'today'],
  group: 'Plan',
  async run(ctx) {
    ctx.navigate('/today?regenerate=1');
    return {};
  },
};

/** Goal neglect stays a goals-page signal; the insights page has no goal detector (week 11). */
export const showNeglectedGoals: CommandDefinition = {
  id: 'show-neglected-goals',
  title: 'Show neglected goals',
  keywords: ['goals', 'attention', 'ignored'],
  group: 'Review',
  async run(ctx) {
    ctx.navigate('/goals?filter=neglected');
    return {};
  },
};

export const openInsights: CommandDefinition = {
  id: 'open-insights',
  title: 'Open insights',
  keywords: ['insights', 'observations', 'stale', 'overloaded', 'estimates', 'attention'],
  group: 'Review',
  available: (ctx) => ctx.capabilities.insights,
  async run(ctx) {
    ctx.navigate('/insights');
    return {};
  },
};

export const reviewThisWeek: CommandDefinition = {
  id: 'review-this-week',
  title: 'Review this week',
  keywords: ['weekly', 'review', 'retrospective'],
  group: 'Review',
  async run(ctx) {
    if (!ctx.capabilities.weeklyReview) {
      ctx.notify({
        title: 'The weekly review is not available yet',
        description: 'It arrives in week 12. Morning and evening reviews are ready today.',
      });
    }
    ctx.navigate('/review/weekly');
    return {};
  },
};

const RescheduleArgs = z.object({
  /** Absent: each task follows the rollover rule for its priority. */
  target: RolloverTargetSchema.or(z.literal('rule')).default('rule'),
});

const TARGET_LABEL: Record<RolloverTarget, string> = {
  tomorrow: 'tomorrow',
  nextWeek: 'next Monday',
  inbox: 'the inbox',
};

/** Today's committed tasks that are not done, with where each would go. */
async function unfinishedToday(
  ctx: CommandContext,
  target: RolloverTarget | 'rule',
): Promise<Array<{ task: Task; target: RolloverTarget }>> {
  const today = toLocalDate(ctx.clock.now());
  const [tasks, sessions, dayCommitments, rules, projects] = await Promise.all([
    ctx.repo.tasks.list(),
    ctx.repo.sessions.list(),
    ctx.repo.dayCommitments.list(),
    ctx.repo.rules.list(),
    ctx.repo.projects.list(),
  ]);
  const review = buildEvening(
    { tasks, sessions, dayCommitments, projects, rules },
    today,
    ctx.clock,
  );
  return review.unfinished.map((task) => ({
    task,
    target: target === 'rule' ? suggestRollover(task, rules) : target,
  }));
}

export const rescheduleUnfinished: CommandDefinition<typeof RescheduleArgs> = {
  id: 'reschedule-unfinished',
  title: 'Reschedule unfinished work',
  keywords: ['rollover', 'move', 'tomorrow', 'carry', 'defer', 'postpone'],
  group: 'Plan',
  args: RescheduleArgs,
  prompt: {
    kind: 'choice',
    field: 'target',
    label: 'Move unfinished tasks to…',
    choices: async () => [
      { value: 'rule', label: 'Where my rollover rule says', hint: 'by priority' },
      { value: 'tomorrow', label: 'Tomorrow' },
      { value: 'nextWeek', label: 'Next Monday' },
      { value: 'inbox', label: 'Back to the inbox' },
    ],
  },
  async preview(ctx, args) {
    const moves = await unfinishedToday(ctx, args.target);
    if (!moves.length) return 'Nothing is unfinished on today’s commitment.';
    const today = toLocalDate(ctx.clock.now());
    const where = new Map<string, number>();
    for (const m of moves) {
      const date = rolloverDate(m.target, today);
      const label = date ? `${TARGET_LABEL[m.target]} (${date})` : TARGET_LABEL[m.target];
      where.set(label, (where.get(label) ?? 0) + 1);
    }
    const parts = [...where].map(([label, n]) => `${n} to ${label}`);
    return `${moves.length} task${moves.length === 1 ? '' : 's'} move: ${parts.join(', ')}.`;
  },
  async run(ctx, args) {
    const moves = await unfinishedToday(ctx, args.target);
    if (!moves.length)
      return { message: 'Nothing to reschedule', detail: 'Today’s commitment is done.' };
    const before = new Map(moves.map((m) => [m.task.id, m.task]));
    const rolled = applyRollover(
      moves.map((m) => ({ taskId: m.task.id, target: m.target })),
      moves.map((m) => m.task),
      ctx.clock,
    );
    const changes: UndoChange[] = [];
    await ctx.repo.transaction(async (tx) => {
      for (const task of rolled) {
        const after = await tx.tasks.upsert(task);
        changes.push({ entity: 'task', entityId: task.id, before: before.get(task.id)!, after });
      }
    });
    return {
      message: `Moved ${changes.length} task${changes.length === 1 ? '' : 's'}`,
      detail:
        args.target === 'rule'
          ? 'Following your rollover rule.'
          : `To ${TARGET_LABEL[args.target]}.`,
      changes,
    };
  },
};

export const undoLast: CommandDefinition = {
  id: 'undo',
  title: 'Undo last action',
  keywords: ['revert', 'back', 'oops'],
  group: 'Orbit',
  shortcut: 'mod+z',
  available: (ctx) => ctx.canUndo?.() ?? false,
  async run() {
    // The registry performs the undo itself, so the stack stays private to it.
    return {};
  },
};

/** Every core command, in palette order. */
export function coreCommands(): CommandDefinition[] {
  return [
    addTask,
    addNote,
    addEvent,
    planMyDay,
    regeneratePlan,
    rescheduleUnfinished,
    showNeglectedGoals,
    openInsights,
    reviewThisWeek,
    openProject,
    undoLast,
  ] as CommandDefinition[];
}

export { COMMAND_STORES };
