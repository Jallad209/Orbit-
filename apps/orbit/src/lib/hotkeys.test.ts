import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HotkeyRegistry, formatHotkey, isTypingTarget, parseHotkey } from './hotkeys';

function key(
  k: string,
  opts: Partial<{
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
    target: EventTarget;
  }> = {},
): KeyboardEvent {
  const e = new KeyboardEvent('keydown', {
    key: k,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    altKey: opts.alt ?? false,
    metaKey: opts.meta ?? false,
    bubbles: true,
    cancelable: true,
  });
  if (opts.target) Object.defineProperty(e, 'target', { value: opts.target });
  return e;
}

describe('parseHotkey', () => {
  it('parses single keys, chords, and sequences', () => {
    expect(parseHotkey('c')).toEqual([
      { key: 'c', ctrl: false, shift: false, alt: false, meta: false },
    ]);
    expect(parseHotkey('ctrl+k')).toEqual([
      { key: 'k', ctrl: true, shift: false, alt: false, meta: false },
    ]);
    expect(parseHotkey('g t')).toHaveLength(2);
    expect(parseHotkey('Esc')[0]?.key).toBe('escape');
  });

  it('rejects unknown modifiers', () => {
    expect(() => parseHotkey('hyper+k')).toThrow(/unknown modifier/);
  });
});

describe('HotkeyRegistry', () => {
  let registry: HotkeyRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new HotkeyRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires a single-key binding', () => {
    const fn = vi.fn();
    registry.register('c', fn);
    expect(registry.handleKeydown(key('c'))).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fires a chord only with the exact modifiers', () => {
    const fn = vi.fn();
    registry.register('ctrl+k', fn);
    expect(registry.handleKeydown(key('k'))).toBe(false);
    expect(registry.handleKeydown(key('k', { ctrl: true, shift: true }))).toBe(false);
    expect(registry.handleKeydown(key('k', { ctrl: true }))).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fires a two-key sequence and prevents default on the first key', () => {
    const fn = vi.fn();
    registry.register('g t', fn);
    const g = key('g');
    expect(registry.handleKeydown(g)).toBe(false);
    expect(g.defaultPrevented).toBe(true);
    expect(registry.handleKeydown(key('t'))).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not fire a sequence after the timeout', () => {
    const fn = vi.fn();
    registry.register('g t', fn);
    registry.handleKeydown(key('g'));
    vi.advanceTimersByTime(900);
    expect(registry.handleKeydown(key('t'))).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not fire a sequence when an unrelated key intervenes', () => {
    const fn = vi.fn();
    registry.register('g t', fn);
    registry.handleKeydown(key('g'));
    registry.handleKeydown(key('x'));
    registry.handleKeydown(key('t'));
    expect(fn).not.toHaveBeenCalled();
  });

  it('ignores hotkeys while typing in an input unless allowed', () => {
    const fn = vi.fn();
    const allowed = vi.fn();
    registry.register('c', fn);
    registry.register('escape', allowed, { allowInInput: true });
    const input = document.createElement('input');
    expect(registry.handleKeydown(key('c', { target: input }))).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(registry.handleKeydown(key('Escape', { target: input }))).toBe(true);
    expect(allowed).toHaveBeenCalledTimes(1);
  });

  it('lets later registrations override earlier ones and unregister cleanly', () => {
    const page = vi.fn();
    const dialog = vi.fn();
    registry.register('escape', page);
    const off = registry.register('escape', dialog);
    registry.handleKeydown(key('Escape'));
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(page).not.toHaveBeenCalled();
    off();
    registry.handleKeydown(key('Escape'));
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('lists described bindings for the shortcuts reference', () => {
    registry.register('g t', () => {}, { description: 'Go to today', group: 'Navigation' });
    registry.register('x', () => {});
    expect(registry.list()).toEqual([
      { spec: 'g t', description: 'Go to today', group: 'Navigation' },
    ]);
  });

  it('ignores pure modifier presses', () => {
    const fn = vi.fn();
    registry.register('g t', fn);
    registry.handleKeydown(key('g'));
    registry.handleKeydown(key('Shift', { shift: true }));
    registry.handleKeydown(key('t'));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('isTypingTarget', () => {
  it('recognises text inputs, textareas, and contenteditable', () => {
    const text = document.createElement('input');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const textarea = document.createElement('textarea');
    const div = document.createElement('div');
    expect(isTypingTarget(text)).toBe(true);
    expect(isTypingTarget(checkbox)).toBe(false);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget(div)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('formatHotkey', () => {
  it('renders human labels', () => {
    expect(formatHotkey('g t')).toBe('G then T');
    expect(formatHotkey('ctrl+k')).toBe('Ctrl K');
    expect(formatHotkey('esc')).toBe('Esc');
  });
});
