import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DIAGNOSTICS_LIMIT,
  clearEvents,
  coarseUserAgent,
  digest,
  installDiagnostics,
  listEvents,
  recordError,
  recordEvent,
  sanitizeRoute,
  sanitizeScript,
  subscribeEvents,
} from './diagnostics';

const SECRET = 'SECRET-TITLE-Buy a birthday gift for Omar';

describe('diagnostics buffer', () => {
  let uninstall: () => void;

  beforeEach(() => {
    clearEvents();
    uninstall = installDiagnostics(window);
  });

  afterEach(() => {
    uninstall();
    clearEvents();
  });

  it('keeps error kinds, positions, and digests, never the message', () => {
    const original = console.error;
    const spy = vi.spyOn(console, 'error');
    console.error(`Failed to save ${SECRET}`);
    console.error(new TypeError(`Cannot read ${SECRET}`));
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: `Uncaught ${SECRET}`,
        error: new RangeError(SECRET),
        filename: 'http://localhost:5173/assets/index-abc.js?v=1#x',
        lineno: 12,
        colno: 34,
      }),
    );
    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(),
        reason: new Error(SECRET),
      }),
    );
    recordEvent('warn', `save ${SECRET}`, { durationMs: 12, retried: true });
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
    console.error = original;

    const events = listEvents();
    expect(events.map((e) => [e.source, e.kind])).toEqual([
      ['console', 'message'],
      ['console', 'TypeError'],
      ['window', 'RangeError'],
      ['promise', 'Error'],
      ['app', `save ${SECRET}`.slice(0, 64)],
    ]);
    expect(events[2]).toMatchObject({ script: '/assets/index-abc.js', line: 12, col: 34 });
    expect(events[4]?.fields).toEqual({ durationMs: 12, retried: true });
    const text = JSON.stringify(events.slice(0, 4));
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('Omar');
    expect(events[0]?.digest).toMatch(/^[0-9a-f]{8}$/u);
    // Same message, same digest: repeats can be grouped without keeping the text.
    expect(recordError('app', new Error('x')).digest).toBe(
      recordError('app', new Error('x')).digest,
    );
    expect(recordError('app', new Error('x')).digest).not.toBe(
      recordError('app', new Error('y')).digest,
    );
  });

  it('is bounded to the last 500 entries and tells subscribers', () => {
    const seen: string[] = [];
    const off = subscribeEvents((e) => seen.push(e.kind));
    for (let i = 0; i < DIAGNOSTICS_LIMIT + 20; i += 1) recordEvent('info', `tick-${i}`);
    expect(listEvents()).toHaveLength(DIAGNOSTICS_LIMIT);
    expect(listEvents()[0]?.kind).toBe('tick-20');
    expect(seen).toHaveLength(DIAGNOSTICS_LIMIT + 20);
    off();
    recordEvent('info', 'after');
    expect(seen).toHaveLength(DIAGNOSTICS_LIMIT + 20);
  });

  it('strips ids, queries, and origins from routes and scripts', () => {
    expect(sanitizeRoute('/projects/019372a0-0000-7000-8000-000000000001?q=secret#frag')).toBe(
      '/projects/:id',
    );
    expect(sanitizeScript('https://example.test/app/main.js?token=abc')).toBe('/app/main.js');
    expect(sanitizeScript('')).toBeUndefined();
    expect(digest('')).toBe('811c9dc5');
  });

  it('reduces the user agent to a family and major version', () => {
    expect(
      coarseUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.4191.66',
      ),
    ).toEqual({ browser: 'Edge 152', os: 'Windows' });
    expect(
      coarseUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      ),
    ).toEqual({ browser: 'Safari 17', os: 'macOS' });
    expect(coarseUserAgent('something else')).toEqual({ browser: 'unknown', os: 'unknown' });
  });
});
