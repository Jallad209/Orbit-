import { create } from 'zustand';

/**
 * Palette UI state that outlives the dialog: whether it is open and which
 * command ids ran most recently (ids only, capped at ten, in localStorage).
 */
export const RECENT_KEY = 'orbit-palette-recent';
export const RECENT_LIMIT = 10;

interface PaletteState {
  open: boolean;
  /** What had focus when the palette opened; focus goes back there on close. */
  opener: HTMLElement | null;
  recent: string[];
  setOpen: (open: boolean) => void;
  markRecent: (commandId: string) => void;
  clearRecent: () => void;
}

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeRecent(ids: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    /* preference only */
  }
}

export const useCommandPalette = create<PaletteState>((set, get) => ({
  open: false,
  opener: null,
  recent: readRecent(),
  setOpen: (open) =>
    set((s) => ({
      open,
      opener: open && !s.open ? (document.activeElement as HTMLElement | null) : s.opener,
    })),
  markRecent: (commandId) => {
    const next = [commandId, ...get().recent.filter((id) => id !== commandId)].slice(
      0,
      RECENT_LIMIT,
    );
    writeRecent(next);
    set({ recent: next });
  },
  clearRecent: () => {
    writeRecent([]);
    set({ recent: [] });
  },
}));

export function openCommandPalette(): void {
  useCommandPalette.getState().setOpen(true);
}
