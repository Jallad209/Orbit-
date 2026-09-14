import { NavLink, useNavigate } from 'react-router';
import {
  CalendarDays,
  CircleDollarSign,
  Compass,
  FolderKanban,
  Inbox,
  Layers,
  Lightbulb,
  ListChecks,
  NotebookPen,
  Settings,
  Sun,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { CommandPaletteTrigger } from '@/features/palette/CommandPalette';
import { cn } from '@/lib/cn';
import { formatHotkey, useHotkey } from '@/lib/hotkeys';

export interface Destination {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Sequence hotkey, e.g. "g t". */
  hotkey?: string;
}

export const DESTINATIONS: Destination[] = [
  { to: '/today', label: 'Today', icon: Sun, hotkey: 'g t' },
  { to: '/inbox', label: 'Inbox', icon: Inbox, hotkey: 'g i' },
  { to: '/timeline', label: 'Timeline', icon: CalendarDays, hotkey: 'g l' },
  { to: '/projects', label: 'Projects', icon: FolderKanban, hotkey: 'g p' },
  { to: '/goals', label: 'Goals', icon: Target, hotkey: 'g g' },
  { to: '/areas', label: 'Areas', icon: Layers, hotkey: 'g a' },
  { to: '/insights', label: 'Insights', icon: Lightbulb, hotkey: 'g o' },
  { to: '/people', label: 'People', icon: Users, hotkey: 'g e' },
  { to: '/bills', label: 'Bills', icon: CircleDollarSign, hotkey: 'g b' },
  { to: '/notes', label: 'Notes', icon: NotebookPen, hotkey: 'g n' },
  { to: '/review/weekly', label: 'Reviews', icon: ListChecks, hotkey: 'g r' },
  { to: '/settings', label: 'Settings', icon: Settings, hotkey: 'g s' },
];

function NavHotkey({ to, hotkey }: { to: string; hotkey: string }) {
  const navigate = useNavigate();
  useHotkey(hotkey, () => navigate(to), {
    description: `Go to ${to.slice(1)}`,
    group: 'Navigation',
  });
  return null;
}

export function NavRail() {
  return (
    <nav aria-label="Primary" className="flex h-full flex-col bg-nav text-nav-fg">
      <div className="flex h-14 items-center gap-2 px-4">
        <span
          aria-hidden="true"
          className="grid size-7 place-items-center rounded-md bg-lime text-lime-ink"
        >
          <Compass className="size-4" strokeWidth={2.25} />
        </span>
        <span className="hidden text-base font-semibold tracking-tight md:inline">Orbit</span>
      </div>

      <div className="px-2 pb-1">
        <CommandPaletteTrigger className="flex h-9 w-full items-center gap-3 rounded-md px-2 text-sm text-nav-muted hover:bg-nav-2 hover:text-nav-fg focus-visible:outline-lime-2" />
      </div>

      <ul className="flex flex-1 flex-col gap-0.5 px-2 py-2">
        {DESTINATIONS.map(({ to, label, icon: Icon, hotkey }) => (
          <li key={to}>
            {hotkey ? <NavHotkey to={to} hotkey={hotkey} /> : null}
            <NavLink
              to={to}
              title={hotkey ? `${label} (${formatHotkey(hotkey)})` : label}
              className={({ isActive }) =>
                cn(
                  'group flex h-9 items-center gap-3 rounded-md px-2 text-sm transition-colors duration-(--duration-fast)',
                  'focus-visible:outline-lime-2',
                  isActive
                    ? 'bg-nav-3 text-nav-fg'
                    : 'text-nav-muted hover:bg-nav-2 hover:text-nav-fg',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-5 w-0.5 rounded-full transition-colors duration-(--duration-fast)',
                      isActive ? 'bg-lime' : 'bg-transparent',
                    )}
                  />
                  <Icon className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                  <span className="hidden flex-1 truncate md:inline">{label}</span>
                  {hotkey ? (
                    <kbd
                      aria-hidden="true"
                      className="hidden font-mono text-[11px] text-nav-muted/70 group-hover:text-nav-muted md:inline"
                    >
                      {hotkey}
                    </kbd>
                  ) : null}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="px-4 py-3 text-[11px] text-nav-muted">
        <span className="hidden md:inline">Offline · your data stays here</span>
      </div>
    </nav>
  );
}
