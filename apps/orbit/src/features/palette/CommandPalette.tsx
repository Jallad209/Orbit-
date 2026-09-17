import { systemClock } from '@orbit/core';
import type { Clock } from '@orbit/core';
import { Search } from 'lucide-react';
import { Suspense, lazy } from 'react';
import { Kbd } from '@/components/ui/Kbd';
import { useHotkey } from '@/lib/hotkeys';
import { useCommandPalette } from './useCommandPalette';

// The dialog, its results, and the argument prompts load on first open.
const PaletteDialog = lazy(() =>
  import('./PaletteDialog').then((m) => ({ default: m.PaletteDialog })),
);

interface Props {
  clock?: Clock;
}

/**
 * `Ctrl+K` from anywhere (a text field included) opens the palette. This
 * shell is all the app carries at startup: the hotkey and the store; the
 * dialog itself arrives when it is first wanted.
 */
export function CommandPalette({ clock = systemClock }: Props) {
  const open = useCommandPalette((s) => s.open);
  const setOpen = useCommandPalette((s) => s.setOpen);

  useHotkey('mod+k', () => setOpen(true), {
    description: 'Command palette and search',
    group: 'General',
    allowInInput: true,
  });

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <PaletteDialog clock={clock} />
    </Suspense>
  );
}

/** A visible way in for mouse users; also the element focus returns to. */
export function CommandPaletteTrigger({ className }: { className?: string }) {
  const setOpen = useCommandPalette((s) => s.setOpen);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={className}
      aria-label="Search and commands"
      aria-keyshortcuts="Control+K"
    >
      <Search className="size-4 shrink-0" aria-hidden="true" />
      <span className="hidden flex-1 truncate text-left md:inline">Search…</span>
      <span className="hidden md:inline">
        <Kbd spec="mod+k" />
      </span>
    </button>
  );
}
