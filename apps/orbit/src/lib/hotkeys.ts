import { createContext, useContext, useEffect } from 'react';

/**
 * Keyboard-first navigation.
 *
 * Specs: single keys (`c`), chords (`ctrl+k`, `mod+k` = ctrl on Windows/Linux,
 * meta on macOS), and sequences (`g t` = press g, then t within 800 ms).
 * Hotkeys are ignored while typing in an input unless `allowInInput` is set.
 */

export interface HotkeyOptions {
  /** Shown in the shortcuts reference. */
  description?: string;
  /** Group for the shortcuts reference (e.g. "Navigation"). */
  group?: string;
  /** Fire even when focus is in a text field. Default false. */
  allowInInput?: boolean;
  /** Call preventDefault on match. Default true. */
  preventDefault?: boolean;
}

export type HotkeyHandler = (event: KeyboardEvent) => void;

interface Step {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

interface Binding {
  spec: string;
  steps: Step[];
  handler: HotkeyHandler;
  options: HotkeyOptions;
}

export interface HotkeyInfo {
  spec: string;
  description: string;
  group: string;
}

const SEQUENCE_TIMEOUT_MS = 800;

const IS_MAC =
  typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform ?? '');

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  space: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  del: 'delete',
};

export function parseHotkey(spec: string): Step[] {
  return spec
    .trim()
    .split(/\s+/)
    .map((token) => {
      const parts = token.toLowerCase().split('+');
      const key = parts.pop() ?? '';
      const step: Step = {
        key: KEY_ALIASES[key] ?? key,
        ctrl: false,
        shift: false,
        alt: false,
        meta: false,
      };
      for (const mod of parts) {
        if (mod === 'ctrl' || mod === 'control') step.ctrl = true;
        else if (mod === 'shift') step.shift = true;
        else if (mod === 'alt' || mod === 'option') step.alt = true;
        else if (mod === 'meta' || mod === 'cmd' || mod === 'win') step.meta = true;
        else if (mod === 'mod') {
          if (IS_MAC) step.meta = true;
          else step.ctrl = true;
        } else throw new Error(`unknown modifier "${mod}" in hotkey "${spec}"`);
      }
      return step;
    });
}

function eventMatchesStep(e: KeyboardEvent, step: Step): boolean {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  return (
    key === step.key &&
    e.ctrlKey === step.ctrl &&
    e.altKey === step.alt &&
    e.metaKey === step.meta &&
    // Shift is only significant when the spec asks for it or the key is a letter.
    (step.shift ? e.shiftKey : !e.shiftKey || step.key.length > 1)
  );
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'file'].includes(type);
  }
  return false;
}

export class HotkeyRegistry {
  private bindings: Binding[] = [];
  private buffer: KeyboardEvent[] = [];
  private bufferTimer: ReturnType<typeof setTimeout> | null = null;

  /** Register a binding. Returns an unregister function. */
  register(spec: string, handler: HotkeyHandler, options: HotkeyOptions = {}): () => void {
    const binding: Binding = { spec, steps: parseHotkey(spec), handler, options };
    // Later registrations win (e.g. a dialog overriding a page binding).
    this.bindings.unshift(binding);
    return () => {
      this.bindings = this.bindings.filter((b) => b !== binding);
    };
  }

  /** Bindings with a description, for the shortcuts reference. */
  list(): HotkeyInfo[] {
    return this.bindings
      .filter((b) => b.options.description)
      .map((b) => ({
        spec: b.spec,
        description: b.options.description ?? '',
        group: b.options.group ?? 'General',
      }))
      .reverse();
  }

  /** Feed a keydown. Returns true when a binding fired. */
  handleKeydown(e: KeyboardEvent): boolean {
    if (e.defaultPrevented) return false;
    // Pure modifier presses never advance a sequence.
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return false;

    const typing = isTypingTarget(e.target);
    this.pushBuffer(e);

    let partial = false;
    for (const b of this.bindings) {
      if (typing && !b.options.allowInInput) continue;
      const match = this.matchBinding(b);
      if (match === 'full') {
        if (b.options.preventDefault !== false) e.preventDefault();
        this.clearBuffer();
        b.handler(e);
        return true;
      }
      if (match === 'partial') partial = true;
    }
    if (partial) {
      // The key started a sequence (e.g. "g" of "g t"); keep the buffer.
      if (!typing) e.preventDefault();
      return false;
    }
    this.clearBuffer();
    return false;
  }

  private matchBinding(b: Binding): 'full' | 'partial' | 'none' {
    const n = this.buffer.length;
    if (n > b.steps.length) {
      // Only the tail of the buffer can match.
      const tail = this.buffer.slice(n - b.steps.length);
      return tail.every((e, i) => eventMatchesStep(e, b.steps[i]!)) ? 'full' : 'none';
    }
    const allMatch = this.buffer.every((e, i) => eventMatchesStep(e, b.steps[i]!));
    if (!allMatch) return 'none';
    return n === b.steps.length ? 'full' : 'partial';
  }

  private pushBuffer(e: KeyboardEvent): void {
    this.buffer.push(e);
    if (this.buffer.length > 4) this.buffer.shift();
    if (this.bufferTimer) clearTimeout(this.bufferTimer);
    this.bufferTimer = setTimeout(() => this.clearBuffer(), SEQUENCE_TIMEOUT_MS);
  }

  private clearBuffer(): void {
    this.buffer = [];
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = null;
    }
  }

  /** Attach to a window/document. Returns a detach function. */
  attach(target: Window | Document = window): () => void {
    const listener = (e: Event) => {
      this.handleKeydown(e as KeyboardEvent);
    };
    target.addEventListener('keydown', listener);
    return () => target.removeEventListener('keydown', listener);
  }
}

/** The app-wide registry. Tests create their own via `new HotkeyRegistry()`. */
export const hotkeys = new HotkeyRegistry();

/** Supplied by `<HotkeyProvider>`; defaults to the app-wide registry. */
export const HotkeyContext = createContext<HotkeyRegistry>(hotkeys);

/** The registry the nearest `<HotkeyProvider>` attached to the window. */
export function useHotkeyRegistry(): HotkeyRegistry {
  return useContext(HotkeyContext);
}

/**
 * Bind a hotkey for the lifetime of a component. `handler` is read through a
 * ref-like closure each render, so callers need not memoize it.
 */
export function useHotkey(spec: string, handler: HotkeyHandler, options: HotkeyOptions = {}): void {
  const registry = useHotkeyRegistry();
  const { description, group, allowInInput, preventDefault } = options;
  useEffect(() => {
    return registry.register(spec, handler, { description, group, allowInInput, preventDefault });
    // handler is intentionally excluded: re-registering per render would reorder priority.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, description, group, allowInInput, preventDefault, registry]);
}

/** Human label for a spec: "mod+k" → "Ctrl K" (or "⌘ K" on macOS). */
export function formatHotkey(spec: string): string {
  return spec
    .trim()
    .split(/\s+/)
    .map((token) =>
      token
        .split('+')
        .map((part) => {
          const p = part.toLowerCase();
          if (p === 'mod') return IS_MAC ? '⌘' : 'Ctrl';
          if (p === 'ctrl') return 'Ctrl';
          if (p === 'shift') return 'Shift';
          if (p === 'alt') return IS_MAC ? '⌥' : 'Alt';
          if (p === 'meta') return IS_MAC ? '⌘' : 'Win';
          if (p === 'escape' || p === 'esc') return 'Esc';
          if (p === 'enter') return 'Enter';
          return p.length === 1 ? p.toUpperCase() : p;
        })
        .join(' '),
    )
    .join(' then ');
}
