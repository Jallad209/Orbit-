/**
 * Local diagnostics: a bounded, in-memory record of what went wrong, kept
 * so a bug report can carry it — never sent anywhere, and never holding
 * user content. Every entry is metadata only: when, what kind of thing,
 * where in the code, and a short digest so repeats can be grouped. Titles,
 * bodies, query text, and raw error objects are never stored.
 */

export const DIAGNOSTICS_LIMIT = 500;

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticEvent {
  at: string;
  level: DiagnosticLevel;
  /** Where it came from: the console bridge, a window error, a rejected promise, or app code. */
  source: 'console' | 'window' | 'promise' | 'app';
  /** The error class or the operation name; never a message. */
  kind: string;
  /** The current route with ids replaced, e.g. `/projects/:id`. */
  route?: string;
  /** Script path (no query string) and position, when the browser reported one. */
  script?: string;
  line?: number;
  col?: number;
  /** 8 hex chars of the message, to group repeats without keeping the text. */
  digest?: string;
  /** Small numbers or flags an app subsystem chose to attach (durations, counts). */
  fields?: Record<string, number | boolean>;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu;

/** FNV-1a over the text, as 8 hex characters. One-way and short: a grouping key, not the text. */
export function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** A route with every id replaced, no query string, no hash. */
export function sanitizeRoute(path: string): string {
  return path.split(/[?#]/u)[0]!.replace(UUID_RE, ':id');
}

/** A script URL reduced to its path: no origin, query, or hash. */
export function sanitizeScript(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  try {
    return sanitizeRoute(new URL(url, 'http://localhost').pathname);
  } catch {
    return undefined;
  }
}

function errorKind(value: unknown): string {
  if (value instanceof Error) return value.name || 'Error';
  if (typeof value === 'string') return 'message';
  if (value === null || value === undefined) return 'empty';
  return typeof value;
}

function errorDigest(value: unknown): string {
  if (value instanceof Error) return digest(`${value.name}:${value.message}`);
  if (typeof value === 'string') return digest(value);
  try {
    return digest(JSON.stringify(value) ?? String(value));
  } catch {
    return digest(String(value));
  }
}

class RingBuffer {
  private entries: DiagnosticEvent[] = [];

  constructor(private readonly limit: number) {}

  push(event: DiagnosticEvent): void {
    this.entries.push(event);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
  }

  list(): DiagnosticEvent[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}

const buffer = new RingBuffer(DIAGNOSTICS_LIMIT);
const listeners = new Set<(event: DiagnosticEvent) => void>();

/** Hear every recorded event (the desktop forwards them to its log file). */
export function subscribeEvents(listener: (event: DiagnosticEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: DiagnosticEvent): void {
  buffer.push(event);
  for (const l of listeners) {
    try {
      l(event);
    } catch {
      /* a listener must never break the app */
    }
  }
}

function currentRoute(): string | undefined {
  if (typeof location === 'undefined') return undefined;
  return sanitizeRoute(location.pathname);
}

/** Record something app code noticed. `fields` may hold numbers and flags only. */
export function recordEvent(
  level: DiagnosticLevel,
  kind: string,
  fields?: Record<string, number | boolean>,
  now: () => Date = () => new Date(),
): DiagnosticEvent {
  const event: DiagnosticEvent = {
    at: now().toISOString(),
    level,
    source: 'app',
    kind: kind.slice(0, 64),
    route: currentRoute(),
  };
  if (fields && Object.keys(fields).length) event.fields = fields;
  emit(event);
  return event;
}

/** Record a caught error: its class and a digest, never its message. */
export function recordError(
  source: DiagnosticEvent['source'],
  error: unknown,
  extra: Partial<Pick<DiagnosticEvent, 'script' | 'line' | 'col'>> = {},
  now: () => Date = () => new Date(),
): DiagnosticEvent {
  const event: DiagnosticEvent = {
    at: now().toISOString(),
    level: 'error',
    source,
    kind: errorKind(error),
    digest: errorDigest(error),
    route: currentRoute(),
    ...extra,
  };
  emit(event);
  return event;
}

export function listEvents(): DiagnosticEvent[] {
  return buffer.list();
}

export function clearEvents(): void {
  buffer.clear();
}

/**
 * Bridge the browser's error channels into the buffer: `console.error`,
 * `window.onerror`, and unhandled promise rejections. The original console
 * still prints; only metadata is kept. Returns the uninstall function.
 */
export function installDiagnostics(target: Window = window): () => void {
  /* eslint-disable no-console -- this is the console bridge itself */
  const original = console.error;
  console.error = (...args: unknown[]) => {
    try {
      recordError('console', args.find((a) => a instanceof Error) ?? args[0]);
    } catch {
      /* never let diagnostics break the app */
    }
    original.apply(console, args);
  };
  const onError = (e: ErrorEvent) => {
    recordError('window', e.error ?? e.message, {
      script: sanitizeScript(e.filename),
      line: e.lineno || undefined,
      col: e.colno || undefined,
    });
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    recordError('promise', e.reason);
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    console.error = original;
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
  /* eslint-enable no-console */
}

/** The browser, coarsely: family and major version, plus the OS family. Never the raw UA string. */
export function coarseUserAgent(ua: string = navigator.userAgent): { browser: string; os: string } {
  const edge = /Edg\/(\d+)/u.exec(ua);
  const chrome = /Chrome\/(\d+)/u.exec(ua);
  const firefox = /Firefox\/(\d+)/u.exec(ua);
  const safari = /Version\/(\d+).*Safari\//u.exec(ua);
  const browser = edge
    ? `Edge ${edge[1]}`
    : chrome
      ? `Chrome ${chrome[1]}`
      : firefox
        ? `Firefox ${firefox[1]}`
        : safari
          ? `Safari ${safari[1]}`
          : 'unknown';
  const os = /Windows/u.test(ua)
    ? 'Windows'
    : /Mac OS/u.test(ua)
      ? 'macOS'
      : /Android/u.test(ua)
        ? 'Android'
        : /iPhone|iPad/u.test(ua)
          ? 'iOS'
          : /Linux/u.test(ua)
            ? 'Linux'
            : 'unknown';
  return { browser, os };
}
