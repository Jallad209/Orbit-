import { systemClock, toLocalDate } from '@orbit/core';
import type { Clock } from '@orbit/core';
import {
  EXPORT_SCHEMA_VERSION,
  INDEXEDDB_SCHEMA_VERSION,
  SQLITE_SCHEMA_VERSION,
  STORE_ENTITY,
} from '@orbit/storage';
import type { Repository, SearchService, StoreName } from '@orbit/storage';
import { coarseUserAgent, listEvents, type DiagnosticEvent } from '@/lib/diagnostics';
import type { LastRun, Platform, StorageStatus } from '@/platform/types';

/**
 * The diagnostics report: what a bug report needs and nothing a person
 * wrote. Versions, the runtime, record counts, the integrity outcome, the
 * search backend, the previous run's fate, and the event ring buffer. It is
 * built only when the user asks, and handed to them as a file — never sent.
 */
export interface DiagnosticsReport {
  generatedAt: string;
  app: { version: string; build: 'web' | 'desktop' };
  runtime: {
    platform: string;
    capabilities: Platform['capabilities'];
    browser: string;
    os: string;
    language: string;
    timezone: string;
  };
  schema: { export: number; indexeddb: number; sqlite: number };
  storage: StorageStatus | null;
  /** Live and deleted row counts per store: numbers, never rows. */
  data: Record<string, { live: number; total: number }>;
  search: { backend: string } | null;
  desktop: {
    integrity: { ok: boolean; messages: number; fts5: boolean };
    recovered: boolean;
  } | null;
  lastRun: LastRun | null;
  events: DiagnosticEvent[];
}

export interface BuildReportInput {
  platform: Platform;
  repo: Repository;
  search?: SearchService | null;
  storage?: StorageStatus | null;
  lastRun?: LastRun | null;
  clock?: Clock;
  events?: DiagnosticEvent[];
}

export async function buildDiagnosticsReport(input: BuildReportInput): Promise<DiagnosticsReport> {
  const clock = input.clock ?? systemClock;
  const { platform, repo } = input;
  const data: DiagnosticsReport['data'] = {};
  for (const name of Object.keys(STORE_ENTITY) as StoreName[]) {
    const store = repo[name];
    const [live, total] = await Promise.all([store.count(), store.count({ includeDeleted: true })]);
    data[name] = { live, total };
  }
  const status = platform.desktop?.dataFileStatus() ?? null;
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return {
    generatedAt: clock.now().toISOString(),
    app: {
      version: typeof __ORBIT_VERSION__ === 'string' ? __ORBIT_VERSION__ : 'dev',
      build: platform.name,
    },
    runtime: {
      platform: platform.name,
      capabilities: platform.capabilities,
      ...coarseUserAgent(ua),
      language: typeof navigator === 'undefined' ? '' : navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    },
    schema: {
      export: EXPORT_SCHEMA_VERSION,
      indexeddb: INDEXEDDB_SCHEMA_VERSION,
      sqlite: SQLITE_SCHEMA_VERSION,
    },
    storage: input.storage ?? null,
    data,
    search: input.search ? { backend: input.search.backend } : null,
    desktop: status
      ? {
          integrity: {
            ok: status.integrity.ok,
            messages: status.integrity.messages.length,
            fts5: status.integrity.fts5,
          },
          recovered: status.recovery !== null,
        }
      : null,
    lastRun: input.lastRun ?? null,
    events: input.events ?? listEvents(),
  };
}

export function diagnosticsFileName(clock: Clock = systemClock, ext: 'json' | 'zip'): string {
  return `orbit-diagnostics-${toLocalDate(clock.now())}.${ext}`;
}

export interface SavedDiagnostics {
  /** Where it went: a path on desktop, the download name on the web. */
  location: string;
  files: string[];
}

/** Hand the report to the user: a zip with the logs on desktop, a JSON download on the web. */
export async function saveDiagnostics(
  platform: Platform,
  report: DiagnosticsReport,
  clock: Clock = systemClock,
): Promise<SavedDiagnostics | null> {
  if (platform.desktop) {
    const bundle = await platform.desktop.saveDiagnostics(
      report,
      diagnosticsFileName(clock, 'zip'),
    );
    return bundle ? { location: bundle.path, files: bundle.files } : null;
  }
  const name = diagnosticsFileName(clock, 'json');
  await platform.exportFile(name, JSON.stringify(report, null, 2), 'application/json');
  return { location: name, files: [name] };
}
