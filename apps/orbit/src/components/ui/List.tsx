import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { isTypingTarget } from '@/lib/hotkeys';

interface ListContextValue {
  selectedId: string | null;
  select: (id: string | null) => void;
  register: (id: string) => () => void;
}

const ListContext = createContext<ListContextValue | null>(null);

export interface ListProps extends Omit<ComponentProps<'ul'>, 'onSelect'> {
  /** Controlled selection. */
  selectedId?: string | null;
  onSelectedChange?: (id: string | null) => void;
  /** Called on Enter or double-click of the selected row. */
  onActivate?: (id: string) => void;
  'aria-label': string;
}

/**
 * Keyboard-navigable list. ArrowUp/ArrowDown and j/k move the selection,
 * Enter activates, Home/End jump. Rows register themselves in DOM order.
 */
export function List({
  selectedId: controlled,
  onSelectedChange,
  onActivate,
  className,
  children,
  onKeyDown,
  role = 'listbox',
  ...props
}: ListProps) {
  const [internal, setInternal] = useState<string | null>(null);
  const selectedId = controlled !== undefined ? controlled : internal;
  const order = useRef<string[]>([]);
  const ulRef = useRef<HTMLUListElement>(null);

  const select = useCallback(
    (id: string | null) => {
      if (controlled === undefined) setInternal(id);
      onSelectedChange?.(id);
    },
    [controlled, onSelectedChange],
  );

  const register = useCallback((id: string) => {
    order.current.push(id);
    return () => {
      order.current = order.current.filter((x) => x !== id);
    };
  }, []);

  // Rows register in mount order, which matches DOM order for a static list;
  // re-derive from the DOM on each keypress to stay correct after reorders.
  const domOrder = () =>
    Array.from(ulRef.current?.querySelectorAll<HTMLElement>('[data-list-row]') ?? []).map(
      (el) => el.dataset.listRow ?? '',
    );

  const handleKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || isTypingTarget(e.target)) return;
    const ids = domOrder();
    if (ids.length === 0) return;
    const idx = selectedId ? ids.indexOf(selectedId) : -1;
    const move = (next: number) => {
      e.preventDefault();
      const clamped = Math.max(0, Math.min(ids.length - 1, next));
      const id = ids[clamped] ?? null;
      select(id);
      ulRef.current?.querySelector<HTMLElement>(`[data-list-row="${id}"]`)?.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        move(idx + 1);
        break;
      case 'ArrowUp':
      case 'k':
        move(idx - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(ids.length - 1);
        break;
      case 'Enter':
        if (selectedId && onActivate) {
          e.preventDefault();
          onActivate(selectedId);
        }
        break;
    }
  };

  const value = useMemo(() => ({ selectedId, select, register }), [selectedId, select, register]);

  return (
    <ListContext.Provider value={value}>
      <ul
        ref={ulRef}
        role={role}
        aria-activedescendant={
          role === 'listbox' && selectedId ? `list-row-${selectedId}` : undefined
        }
        className={cn('flex flex-col gap-0.5 outline-none', className)}
        onKeyDown={handleKeyDown}
        {...props}
      >
        {children}
      </ul>
    </ListContext.Provider>
  );
}

export interface ListRowProps extends Omit<ComponentProps<'li'>, 'id'> {
  id: string;
  /** Leading slot (checkbox, icon). */
  leading?: ReactNode;
  /** Trailing slot (badges, meta). */
  trailing?: ReactNode;
  onActivate?: (id: string) => void;
}

export function ListRow({
  id,
  leading,
  trailing,
  onActivate,
  className,
  children,
  onClick,
  onDoubleClick,
  role = 'option',
  ...props
}: ListRowProps) {
  const ctx = useContext(ListContext);
  if (!ctx) throw new Error('<ListRow> must be inside <List>');
  const { selectedId, select, register } = ctx;
  const selected = selectedId === id;

  useEffect(() => register(id), [id, register]);

  return (
    <li
      id={`list-row-${id}`}
      role={role}
      aria-selected={role === 'option' ? selected : undefined}
      data-list-row={id}
      tabIndex={selected ? 0 : -1}
      className={cn(
        'group flex min-h-10 cursor-default items-center gap-3 rounded-md px-2.5 text-sm outline-none',
        'transition-colors duration-(--duration-fast)',
        selected ? 'bg-surface-3 text-ink' : 'text-ink hover:bg-surface-2',
        'focus-visible:outline-2 focus-visible:outline-ink',
        className,
      )}
      onClick={(e) => {
        onClick?.(e);
        select(id);
      }}
      onDoubleClick={(e) => {
        onDoubleClick?.(e);
        onActivate?.(id);
      }}
      {...props}
    >
      {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing ? <span className="flex shrink-0 items-center gap-1.5">{trailing}</span> : null}
    </li>
  );
}
