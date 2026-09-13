import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AreaSchema,
  NoteSchema,
  PersonSchema,
  TaskSchema,
  createRecord,
  fixedClock,
} from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { createMiniSearchService } from '@orbit/storage/search/minisearch';
import type { Repository } from '@orbit/storage';
import { useAppStore } from '@/app/store';
import { clearEvents, installDiagnostics, recordError } from '@/lib/diagnostics';
import { webPlatform, type Platform } from '@/platform';
import type { DesktopApi } from '@/platform/types';
import { renderWithProviders } from '@/test/render';
import { DiagnosticsSettings } from './DiagnosticsSettings';
import { buildDiagnosticsReport, diagnosticsFileName, saveDiagnostics } from './diagnosticsService';

const clock = fixedClock(new Date(2026, 8, 14, 10, 0, 0));
const SECRETS = ['SECRET-TITLE', 'SECRET-BODY', 'SECRET-PERSON', 'secret@example.com'];

async function sensitiveRepo(): Promise<Repository> {
  const repo = createMemoryRepository({ clock });
  const area = createRecord(AreaSchema, clock, { name: 'SECRET-AREA' });
  await repo.areas.upsert(area);
  await repo.tasks.upsert(
    createRecord(TaskSchema, clock, {
      title: 'SECRET-TITLE',
      status: 'open',
      notes: 'SECRET-BODY',
    }),
  );
  await repo.notes.upsert(
    createRecord(NoteSchema, clock, { title: 'SECRET-TITLE 2', body: 'SECRET-BODY' }),
  );
  await repo.people.upsert(
    createRecord(PersonSchema, clock, { name: 'SECRET-PERSON', contact: 'secret@example.com' }),
  );
  return repo;
}

function desktopWith(overrides: Partial<DesktopApi>): Platform {
  return {
    ...webPlatform,
    name: 'desktop',
    capabilities: { ...webPlatform.capabilities, dataFolder: true, nativeReminders: true },
    desktop: {
      dataFileStatus: () => ({
        dir: 'C:\\Users\\me\\AppData\\Roaming\\app.orbit.desktop\\data',
        path: 'C:\\Users\\me\\AppData\\Roaming\\app.orbit.desktop\\data\\orbit.db',
        integrity: { ok: true, messages: ['ok'], fts5: true },
        recovery: null,
      }),
      pickDataFolder: async () => null,
      relocateData: async () => {},
      revealDataFolder: async () => {},
      pickExportFile: async () => null,
      listBackups: async () => [],
      restoreBackup: async () => {},
      hideCaptureWindow: async () => {},
      startDraggingWindow: async () => {},
      lastRun: async () => ({ crashedLastTime: false, startedAt: null, crash: null }),
      saveDiagnostics: async () => null,
      logEvent: async () => {},
      ...overrides,
    },
  };
}

describe('diagnostics report', () => {
  let uninstall: () => void;
  beforeEach(() => {
    clearEvents();
    uninstall = installDiagnostics(window);
  });
  afterEach(() => {
    uninstall();
    clearEvents();
  });

  it('contains versions, counts, and event metadata, and none of the sensitive strings', async () => {
    const repo = await sensitiveRepo();
    const search = createMiniSearchService({ repo });
    await search.ready();
    // Errors that carry user text through every channel.
    recordError('console', new Error('Could not save SECRET-TITLE for SECRET-PERSON'));
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'SECRET-BODY', error: new Error('SECRET-BODY') }),
    );
    const report = await buildDiagnosticsReport({
      platform: webPlatform,
      repo,
      search,
      storage: { persisted: true, usageBytes: 10, quotaBytes: 100 },
      clock,
    });
    const text = JSON.stringify(report);
    for (const s of SECRETS) expect(text).not.toContain(s);
    expect(text).not.toContain('SECRET');
    expect(report).toMatchObject({
      generatedAt: clock.now().toISOString(),
      app: { build: 'web' },
      schema: { export: 3, indexeddb: 3, sqlite: 2 },
      data: {
        tasks: { live: 1, total: 1 },
        notes: { live: 1, total: 1 },
        people: { live: 1, total: 1 },
      },
      search: { backend: 'minisearch' },
      desktop: null,
    });
    expect(report.events.length).toBe(2);
    expect(report.events.every((e) => e.kind === 'Error' && e.digest)).toBe(true);
    expect(diagnosticsFileName(clock, 'json')).toBe('orbit-diagnostics-2026-09-14.json');
  });

  it('downloads a JSON file on the web and a zip through the desktop shell', async () => {
    const repo = await sensitiveRepo();
    const exportFile = vi.fn<Platform['exportFile']>(async () => {});
    const web: Platform = { ...webPlatform, exportFile };
    const report = await buildDiagnosticsReport({ platform: web, repo, clock });
    expect(await saveDiagnostics(web, report, clock)).toEqual({
      location: 'orbit-diagnostics-2026-09-14.json',
      files: ['orbit-diagnostics-2026-09-14.json'],
    });
    expect(exportFile).toHaveBeenCalledWith(
      'orbit-diagnostics-2026-09-14.json',
      expect.stringContaining('"generatedAt"'),
      'application/json',
    );
    expect(String(exportFile.mock.calls[0]?.[1])).not.toContain('SECRET');

    const saveDiagnosticsNative = vi.fn(async () => ({
      path: 'D:\\bundle.zip',
      files: ['report.json', 'logs/orbit-2026-09-14.000.log'],
      bytes: 1234,
    }));
    const desktop = desktopWith({ saveDiagnostics: saveDiagnosticsNative });
    const desktopReport = await buildDiagnosticsReport({ platform: desktop, repo, clock });
    expect(desktopReport.desktop).toEqual({
      integrity: { ok: true, messages: 1, fts5: true },
      recovered: false,
    });
    expect(JSON.stringify(desktopReport)).not.toContain('AppData'); // no paths either
    expect(await saveDiagnostics(desktop, desktopReport, clock)).toEqual({
      location: 'D:\\bundle.zip',
      files: ['report.json', 'logs/orbit-2026-09-14.000.log'],
    });
    expect(saveDiagnosticsNative).toHaveBeenCalledWith(
      desktopReport,
      'orbit-diagnostics-2026-09-14.zip',
    );
    const cancelled = desktopWith({ saveDiagnostics: async () => null });
    expect(await saveDiagnostics(cancelled, desktopReport, clock)).toBeNull();
  });
});

describe('DiagnosticsSettings', () => {
  beforeEach(() => {
    clearEvents();
    useAppStore.setState({ storageStatus: { persisted: true, usageBytes: 1, quotaBytes: 2 } });
  });

  it('saves a bundle and shows where it went, or the failure', async () => {
    const user = userEvent.setup();
    const repo = await sensitiveRepo();
    const exportFile = vi.fn(async () => {});
    renderWithProviders(<DiagnosticsSettings clock={clock} />, {
      repository: repo,
      platform: { ...webPlatform, exportFile },
    });
    expect(screen.getByTestId('diagnostics-settings')).toHaveTextContent('no telemetry');
    await user.click(screen.getByRole('button', { name: 'Save diagnostics bundle' }));
    expect(await screen.findByTestId('diagnostics-saved')).toHaveTextContent(
      'orbit-diagnostics-2026-09-14.json',
    );
    expect(exportFile).toHaveBeenCalledTimes(1);

    exportFile.mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByRole('button', { name: 'Save diagnostics bundle' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full');
  });

  it('reports the previous run on desktop', async () => {
    const platform = desktopWith({
      lastRun: async () => ({
        crashedLastTime: true,
        startedAt: '2026-09-13T20:00:00.000Z',
        crash: { at: '2026-09-13T20:05:00.000Z', location: 'src/scheduler.rs:42', message: 'boom' },
      }),
    });
    renderWithProviders(<DiagnosticsSettings clock={clock} />, { platform });
    await waitFor(() =>
      expect(screen.getByTestId('last-run')).toHaveTextContent('did not close cleanly last time'),
    );
    expect(screen.getByTestId('last-run')).toHaveTextContent('src/scheduler.rs:42');
  });
});
