import { coreCommands, createCommandRegistry, systemClock } from '@orbit/core';
import type {
  Clock,
  CommandContext,
  CommandDefinition,
  CommandRegistry,
  CommandRunResult,
} from '@orbit/core';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { DESTINATIONS } from '@/components/layout/NavRail';
import { toast } from '@/components/ui/toastStore';
import { bumpData, useRepoQuery } from '@/data/useQuery';
import { loadCaptureNames } from '@/features/inbox/inboxService';
import { usePlanPrefs } from '@/features/today/planSettings';
import { useRepository } from '@/platform';

/**
 * The app's command registry: the core commands plus one "Go to…" per
 * navigation destination. Screens run commands through `runCommand`, which
 * turns the outcome into toasts (with Undo) and a data refresh.
 */

/** "Go to Today", "Go to Inbox", …: the rail's destinations as commands. */
export function navigationCommands(): CommandDefinition[] {
  return [
    ...DESTINATIONS.map<CommandDefinition>((d) => ({
      id: `go-${d.to.slice(1).replace(/\//gu, '-')}`,
      title: `Go to ${d.label}`,
      keywords: ['navigate', 'open', 'show', d.label.toLowerCase()],
      group: 'Navigate',
      shortcut: d.hotkey,
      async run(ctx) {
        ctx.navigate(d.to);
        return {};
      },
    })),
    {
      id: 'search-everything',
      title: 'Search everything',
      keywords: ['find', 'look', 'query'],
      group: 'Navigate',
      async run(ctx) {
        ctx.navigate('/search');
        return {};
      },
    },
  ];
}

export function createAppCommandRegistry(): CommandRegistry {
  return createCommandRegistry({ commands: [...coreCommands(), ...navigationCommands()] });
}

const CommandRegistryContext = createContext<CommandRegistry | null>(null);

interface ProviderProps {
  registry?: CommandRegistry;
  children: ReactNode;
}

/** One registry (and one undo stack) per app session; tests pass their own. */
export function CommandRegistryProvider({ registry, children }: ProviderProps) {
  const value = useMemo(() => registry ?? createAppCommandRegistry(), [registry]);
  return (
    <CommandRegistryContext.Provider value={value}>{children}</CommandRegistryContext.Provider>
  );
}

export function useCommandRegistry(): CommandRegistry {
  const registry = useContext(CommandRegistryContext);
  if (!registry)
    throw new Error('useCommandRegistry must be used inside <CommandRegistryProvider>');
  return registry;
}

/** The context commands run with on this screen: repository, router, toasts, settings. */
export function useCommandContext(clock: Clock = systemClock): CommandContext {
  const repo = useRepository();
  const navigate = useNavigate();
  const defaultEstimateMin = usePlanPrefs((s) => s.defaultEstimateMin);
  const { data: names } = useRepoQuery(loadCaptureNames, []);
  return useMemo<CommandContext>(
    () => ({
      repo,
      clock,
      navigate: (path) => void navigate(path),
      notify: (n) =>
        toast({ title: n.title, description: n.description, variant: n.tone ?? 'neutral' }),
      capabilities: { insights: true, weeklyReview: false },
      settings: { defaultEstimateMin },
      names: names ?? { people: [], projects: [] },
    }),
    [repo, clock, navigate, defaultEstimateMin, names],
  );
}

/** Undo the newest command, reporting the result. */
export async function undoLastCommand(
  registry: CommandRegistry,
  ctx: CommandContext,
): Promise<void> {
  const result = await registry.run('undo', ctx);
  if (result.ok) {
    bumpData();
    toast({ title: result.outcome.message ?? 'Undone', variant: 'success' });
  } else {
    toast({ title: 'Could not undo', description: result.message, variant: 'danger' });
  }
}

/**
 * Run a command and report: a success toast with Undo when the command
 * changed records, a danger toast when it failed. Validation failures are
 * returned to the caller (the prompt shows them inline) without a toast.
 */
export async function runCommand(
  registry: CommandRegistry,
  id: string,
  ctx: CommandContext,
  args?: unknown,
): Promise<CommandRunResult> {
  const result = await registry.run(id, ctx, args);
  if (result.ok) {
    const { outcome, undoId } = result;
    if (outcome.changes?.length) bumpData();
    if (outcome.message) {
      toast({
        title: outcome.message,
        description: outcome.detail,
        variant: outcome.changes?.length ? 'success' : 'neutral',
        action: undoId
          ? { label: 'Undo', onClick: () => void undoLastCommand(registry, ctx) }
          : undefined,
      });
    }
  } else if (result.kind === 'failed') {
    toast({ title: 'Could not run that', description: result.message, variant: 'danger' });
  }
  return result;
}
