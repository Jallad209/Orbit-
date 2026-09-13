import type { z } from 'zod';
import type {
  CommandContext,
  CommandDefinition,
  CommandRunResult,
  CommandValidationFailure,
} from './types';
import { createUndoStack, type UndoResult, type UndoStack } from './undo';

/**
 * Holds the commands, validates their arguments, runs them, and records
 * what they changed on the undo stack. One registry per app session; the
 * palette lists from it and runs through it, never calling `run` directly.
 */
export interface CommandRegistry {
  /** Commands in registration order; with a context, only the available ones. */
  list(ctx?: CommandContext): CommandDefinition[];
  get(id: string): CommandDefinition | undefined;
  /** Add a command (the app adds navigation); returns the unregister function. */
  register(def: CommandDefinition): () => void;
  validate<S extends z.ZodTypeAny>(
    def: CommandDefinition<S>,
    raw: unknown,
  ): { ok: true; args: z.output<S> } | CommandValidationFailure;
  run(id: string, ctx: CommandContext, rawArgs?: unknown): Promise<CommandRunResult>;
  readonly undo: UndoStack;
  undoLast(ctx: CommandContext): Promise<UndoResult>;
}

export interface CommandRegistryOptions {
  commands?: readonly CommandDefinition[];
  undo?: UndoStack;
}

/** The registry's own view of a context: it knows whether undo has anything. */
function withUndo(ctx: CommandContext, undo: UndoStack): CommandContext {
  return { canUndo: () => undo.size > 0, ...ctx };
}

function issuesToErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    out[key] ??= issue.message;
  }
  return out;
}

export function createCommandRegistry(options: CommandRegistryOptions = {}): CommandRegistry {
  const defs = new Map<string, CommandDefinition>();
  for (const d of options.commands ?? []) defs.set(d.id, d);
  const undo = options.undo ?? createUndoStack();

  const validate: CommandRegistry['validate'] = (def, raw) => {
    if (!def.args) return { ok: true, args: {} as never };
    const parsed = def.args.safeParse(raw ?? {});
    if (parsed.success) return { ok: true, args: parsed.data as never };
    const errors = issuesToErrors(parsed.error);
    return {
      ok: false,
      kind: 'invalid',
      errors,
      message: Object.values(errors)[0] ?? 'Check the input.',
    };
  };

  return {
    undo,

    list(ctx) {
      const all = [...defs.values()];
      if (!ctx) return all;
      const full = withUndo(ctx, undo);
      return all.filter((d) => !d.available || d.available(full));
    },

    get(id) {
      return defs.get(id);
    },

    register(def) {
      defs.set(def.id, def);
      return () => {
        if (defs.get(def.id) === def) defs.delete(def.id);
      };
    },

    validate,

    async run(id, ctx, rawArgs) {
      const def = defs.get(id);
      if (!def) return { ok: false, kind: 'failed', message: `Unknown command "${id}".` };
      const full = withUndo(ctx, undo);
      if (def.available && !def.available(full)) {
        return { ok: false, kind: 'failed', message: `"${def.title}" is not available right now.` };
      }
      if (id === 'undo') {
        const result = await undo.undoLast(full.repo);
        if (!result.ok) return { ok: false, kind: 'failed', message: result.message };
        return { ok: true, outcome: { message: `Undid: ${result.entry.title}` }, undoId: null };
      }
      const checked = validate(def, rawArgs);
      if (!checked.ok) return checked;
      try {
        const outcome = await def.run(full, checked.args);
        let undoId: string | null = null;
        if (outcome.changes?.length) {
          undoId = undo.push(
            { commandId: def.id, title: def.title, changes: outcome.changes },
            full.clock,
          ).id;
        }
        return { ok: true, outcome, undoId };
      } catch (e) {
        return {
          ok: false,
          kind: 'failed',
          message: e instanceof Error ? e.message : String(e),
        };
      }
    },

    undoLast(ctx) {
      return undo.undoLast(ctx.repo);
    },
  };
}
