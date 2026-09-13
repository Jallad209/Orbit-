import type { CommandDefinition } from '@orbit/core';
import type { SearchHit } from '@orbit/storage';
import { highlightSegments, termMatcher } from '@orbit/storage';
import { ArrowRight, Search } from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { TypeBadge } from '@/components/ui/Badge';
import { Kbd } from '@/components/ui/Kbd';
import { cn } from '@/lib/cn';

/** One row in the palette: a command, a search hit, or the "search everything" tail. */
export type PaletteItem =
  | { kind: 'command'; id: string; command: CommandDefinition; recent?: boolean }
  | { kind: 'hit'; id: string; hit: SearchHit }
  | { kind: 'search-all'; id: 'search-all'; query: string };

export interface PaletteGroup {
  label: string;
  items: PaletteItem[];
}

interface Props {
  groups: PaletteGroup[];
  activeId: string | null;
  query: string;
  loading: boolean;
  onActivate: (item: PaletteItem) => void;
  onHover: (id: string) => void;
}

export const PALETTE_LIST_ID = 'command-palette-list';

export function paletteDomId(id: string): string {
  return `palette-option-${id.replace(/[^a-zA-Z0-9_-]/gu, '_')}`;
}

/** Text with `<mark>` around the matched words; plain React segments, never HTML. */
export function Highlighted({ text, query }: { text: string; query: string }): ReactNode {
  const matcher = useMemo(() => termMatcher(query), [query]);
  const segments = useMemo(() => highlightSegments(text, matcher), [text, matcher]);
  return (
    <>
      {segments.map((s, i) =>
        s.match ? (
          <mark key={i} className="rounded-sm bg-lime/50 text-inherit">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

function Row({
  item,
  active,
  query,
  onActivate,
  onHover,
}: {
  item: PaletteItem;
  active: boolean;
  query: string;
  onActivate: (item: PaletteItem) => void;
  onHover: (id: string) => void;
}) {
  const base = cn(
    'flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-sm',
    active ? 'bg-surface-2 text-ink' : 'text-ink-muted',
  );
  return (
    <li
      id={paletteDomId(item.id)}
      role="option"
      aria-selected={active}
      data-kind={item.kind}
      className={base}
      onMouseMove={() => onHover(item.id)}
      onClick={() => onActivate(item)}
    >
      {item.kind === 'command' ? (
        <>
          <ArrowRight className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-medium text-ink">
            <Highlighted text={item.command.title} query={query} />
          </span>
          <span className="text-[11px] text-ink-faint">{item.command.group}</span>
          {item.command.shortcut ? <Kbd spec={item.command.shortcut} /> : null}
        </>
      ) : item.kind === 'hit' ? (
        <>
          <TypeBadge kind={item.hit.type} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-ink">
              <Highlighted text={item.hit.title} query={query} />
            </span>
            {item.hit.snippet ? (
              <span className="block truncate text-[12px] text-ink-faint">
                <Highlighted text={item.hit.snippet} query={query} />
              </span>
            ) : null}
          </span>
        </>
      ) : (
        <>
          <Search className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            Search everything for <span className="font-medium text-ink">“{item.query}”</span>
          </span>
          <Kbd>Enter</Kbd>
        </>
      )}
    </li>
  );
}

/** The grouped, keyboard-driven list under the palette input. */
export function PaletteResults({ groups, activeId, query, loading, onActivate, onHover }: Props) {
  useEffect(() => {
    if (!activeId) return;
    document.getElementById(paletteDomId(activeId))?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const empty = groups.every((g) => g.items.length === 0);
  return (
    <div className="max-h-[50vh] overflow-y-auto px-2 py-2">
      {empty ? (
        <p className="px-3 py-6 text-center text-sm text-ink-muted" data-testid="palette-empty">
          {loading ? 'Searching…' : 'Nothing matches. Try fewer words, or type:note / area:name.'}
        </p>
      ) : null}
      <ul id={PALETTE_LIST_ID} role="listbox" aria-label="Commands and results">
        {groups
          .filter((g) => g.items.length)
          .map((g) => (
            <li key={g.label} role="presentation">
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
                {g.label}
              </div>
              <ul role="group" aria-label={g.label}>
                {g.items.map((item) => (
                  <Row
                    key={item.id}
                    item={item}
                    active={item.id === activeId}
                    query={query}
                    onActivate={onActivate}
                    onHover={onHover}
                  />
                ))}
              </ul>
            </li>
          ))}
      </ul>
    </div>
  );
}
