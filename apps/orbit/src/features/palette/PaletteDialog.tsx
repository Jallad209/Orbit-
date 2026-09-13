import { systemClock } from '@orbit/core';
import type { Clock, CommandDefinition } from '@orbit/core';
import type { SearchHit } from '@orbit/storage';
import { Search } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Kbd } from '@/components/ui/Kbd';
import { useSearch } from '@/features/search/searchService';
import { ArgumentPrompt } from './ArgumentPrompt';
import { runCommand, useCommandContext, useCommandRegistry } from './commandRegistry';
import { matchCommands } from './matchCommands';
import {
  PALETTE_LIST_ID,
  PaletteResults,
  paletteDomId,
  type PaletteGroup,
  type PaletteItem,
} from './PaletteResults';
import { useCommandPalette } from './useCommandPalette';

/** How many of each the palette shows before pointing at the full search. */
export const PALETTE_COMMAND_LIMIT = 8;
export const PALETTE_HIT_LIMIT = 6;
export const RECENT_SHOWN = 4;

/** Where a search hit opens: projects have a page; the rest open in the search preview. */
export function pathForHit(hit: SearchHit, query: string): string {
  if (hit.type === 'project') return `/projects/${hit.id}`;
  const params = new URLSearchParams({ q: query, open: `${hit.type}:${hit.id}` });
  return `/search?${params.toString()}`;
}

interface Props {
  clock?: Clock;
}

/**
 * The open palette: one box for commands and search. Commands match
 * locally and instantly; search results arrive a beat later from the
 * index. Arrow keys move, Enter runs or opens, Escape closes (or steps back
 * out of a prompt). A command that needs input asks for it inline. Loaded
 * on first open (`CommandPalette` owns the hotkey), so the shell's first
 * paint does not carry it.
 */
export function PaletteDialog({ clock = systemClock }: Props) {
  const open = useCommandPalette((s) => s.open);
  const opener = useCommandPalette((s) => s.opener);
  const setOpen = useCommandPalette((s) => s.setOpen);
  const recent = useCommandPalette((s) => s.recent);
  const markRecent = useCommandPalette((s) => s.markRecent);
  const registry = useCommandRegistry();
  const ctx = useCommandContext(clock);

  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState<CommandDefinition | null>(null);
  const [undoTick, setUndoTick] = useState(0);

  // Availability (the undo command) changes with the stack.
  useEffect(() => registry.undo.subscribe(() => setUndoTick((t) => t + 1)), [registry]);

  const available = useMemo(
    () => (open ? registry.list(ctx) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- undoTick re-lists after an undo push/pop
    [registry, ctx, open, undoTick],
  );

  const { hits, loading } = useSearch(query, {
    limit: PALETTE_HIT_LIMIT,
    enabled: open && !pending,
  });

  const groups = useMemo<PaletteGroup[]>(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      const byId = new Map(available.map((c) => [c.id, c]));
      const recentItems: PaletteItem[] = recent
        .map((id) => byId.get(id))
        .filter((c): c is CommandDefinition => !!c)
        .slice(0, RECENT_SHOWN)
        .map((command) => ({ kind: 'command', id: `recent:${command.id}`, command, recent: true }));
      const all: PaletteItem[] = available.map((command) => ({
        kind: 'command',
        id: `command:${command.id}`,
        command,
      }));
      return [
        { label: 'Recent', items: recentItems },
        { label: 'Commands', items: all },
      ];
    }
    const commands: PaletteItem[] = matchCommands(available, trimmed, recent)
      .slice(0, PALETTE_COMMAND_LIMIT)
      .map(({ command }) => ({ kind: 'command', id: `command:${command.id}`, command }));
    const results: PaletteItem[] = hits.map((hit) => ({
      kind: 'hit',
      id: `hit:${hit.type}:${hit.id}`,
      hit,
    }));
    return [
      { label: 'Commands', items: commands },
      { label: 'Results', items: results },
      { label: 'More', items: [{ kind: 'search-all', id: 'search-all', query: trimmed }] },
    ];
  }, [query, available, recent, hits]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const active = flat.find((i) => i.id === activeId) ?? flat[0] ?? null;

  const reset = () => {
    setQuery('');
    setActiveId(null);
    setPending(null);
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const activate = async (item: PaletteItem) => {
    if (item.kind === 'search-all') {
      close();
      ctx.navigate(`/search?q=${encodeURIComponent(item.query)}`);
      return;
    }
    if (item.kind === 'hit') {
      close();
      ctx.navigate(pathForHit(item.hit, query.trim()));
      return;
    }
    const { command } = item;
    markRecent(command.id);
    if (command.prompt) {
      setPending(command);
      return;
    }
    close();
    await runCommand(registry, command.id, ctx);
  };

  const runPending = async (args: unknown) => {
    if (!pending) return;
    const id = pending.id;
    close();
    await runCommand(registry, id, ctx, args);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      const index = active ? flat.findIndex((i) => i.id === active.id) : -1;
      const next =
        e.key === 'ArrowDown' ? (index + 1) % flat.length : (index - 1 + flat.length) % flat.length;
      setActiveId(flat[next]!.id);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActiveId(e.key === 'Home' ? (flat[0]?.id ?? null) : (flat[flat.length - 1]?.id ?? null));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (active) void activate(active);
    }
  };

  const commandCount = groups
    .filter((g) => g.label !== 'Results' && g.label !== 'More')
    .reduce((n, g) => n + g.items.length, 0);
  const status = query.trim()
    ? `${commandCount} command${commandCount === 1 ? '' : 's'}, ${loading ? 'searching…' : `${hits.length} result${hits.length === 1 ? '' : 's'}`}`
    : `${available.length} commands`;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else close();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-nav/30 backdrop-blur-[2px] animate-fade-in" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            if (pending) {
              e.preventDefault();
              setPending(null);
            }
          }}
          onCloseAutoFocus={(e) => {
            // Radix would focus a Dialog.Trigger; the palette opens from a chord, so go back ourselves.
            e.preventDefault();
            if (opener?.isConnected) opener.focus();
          }}
          className="fixed top-[14vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-surface shadow-xl shadow-nav/20 animate-slide-down focus:outline-none"
          data-testid="command-palette"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          {pending ? (
            <ArgumentPrompt
              command={pending}
              ctx={ctx}
              registry={registry}
              onRun={runPending}
              onBack={() => setPending(null)}
            />
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-line px-3">
                <Search className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                <input
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={PALETTE_LIST_ID}
                  aria-activedescendant={active ? paletteDomId(active.id) : undefined}
                  aria-autocomplete="list"
                  aria-label="Command or search"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Type a command, or search tasks, notes, projects, people…"
                  className="h-12 w-full bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveId(null);
                  }}
                  onKeyDown={onKey}
                />
                <Kbd>Esc</Kbd>
              </div>
              <PaletteResults
                groups={groups}
                activeId={active?.id ?? null}
                query={query.trim()}
                loading={loading}
                onActivate={(item) => void activate(item)}
                onHover={setActiveId}
              />
              <div role="status" aria-live="polite" className="sr-only">
                {status}
              </div>
              <div className="flex items-center gap-3 border-t border-line px-3 py-2 text-[11px] text-ink-faint">
                <span>
                  <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
                </span>
                <span>
                  <Kbd>Enter</Kbd> run or open
                </span>
                <span>
                  <Kbd>type:note</Kbd> <Kbd>area:name</Kbd> filter
                </span>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
