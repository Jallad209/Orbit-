import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  APP_SETTINGS_ID,
  AreaSchema,
  CaptureSchema,
  NoteSchema,
  ProjectSchema,
  TaskSchema,
  createRecord,
  fixedClock,
  seedWorld,
} from '@orbit/core';
import { createMemoryRepository, exportJson, serializeExport } from '@orbit/storage';
import type { BackupCandidate } from '@orbit/storage';
import { useToastStore } from '@/components/ui/toastStore';
import { webPlatform, type Platform } from '@/platform';
import { usePlanPrefs } from '@/features/today/planSettings';
import { createTask } from '@/features/structure/structureService';
import { convertCapture } from '@/features/inbox/inboxService';
import { renderWithProviders } from '@/test/render';
import { fakeResidentApi } from '@/test/desktop';
import { DataSettings, bundleMarkdown } from './DataSettings';
import { PlanningSettings } from './PlanningSettings';
import { loadSettings, saveSettings } from './settingsService';
import { ShortcutsReference } from './ShortcutsReference';

const clock = fixedClock(new Date(2026, 8, 14, 9, 0, 0));

function reset() {
  usePlanPrefs.setState({
    workingWindow: { startMin: 540, endMin: 1080 },
    restBoundaries: [{ startMin: 750, endMin: 795 }],
    bufferMin: 10,
    defaultEstimateMin: 30,
    eveningStartMin: 17 * 60,
    hydrated: false,
    energyByDate: {},
  });
  useToastStore.getState().clear();
  localStorage.clear();
}

describe('settingsService', () => {
  beforeEach(reset);

  it('applies the saved task estimate to direct creation and capture, preserving explicit estimates', async () => {
    const repo = createMemoryRepository({ clock });
    await saveSettings(repo, { defaultEstimateMin: 90 }, clock);
    const area = createRecord(AreaSchema, clock, { name: 'Work' });
    await repo.areas.upsert(area);
    expect((await createTask(repo, { title: 'Default', areaId: area.id }, clock)).estimateMin).toBe(
      90,
    );
    expect(
      (await createTask(repo, { title: 'Explicit', areaId: area.id, estimateMin: 45 }, clock))
        .estimateMin,
    ).toBe(45);
    for (const estimate of [undefined, 20]) {
      const capture = createRecord(CaptureSchema, clock, {
        text: 'Captured task',
        type: 'task',
        confidence: 1,
        fields: { title: 'Captured task', ...(estimate ? { estimateMin: estimate } : {}) },
      });
      await repo.captures.upsert(capture);
      const primary = await convertCapture(repo, capture, { areaId: area.id }, clock);
      expect((await repo.tasks.get(primary.id))!.estimateMin).toBe(estimate ?? 90);
    }
  });

  it('creates the document on first read, migrating the localStorage window once', async () => {
    localStorage.setItem(
      'orbit-plan-prefs',
      JSON.stringify({
        state: { workingWindow: { startMin: 480, endMin: 960 }, restBoundaries: [] },
        version: 0,
      }),
    );
    const repo = createMemoryRepository({ clock });
    const s = await loadSettings(repo, clock);
    expect(s.id).toBe(APP_SETTINGS_ID);
    expect(s.workingWindow).toEqual({ startMin: 480, endMin: 960 });
    expect(s.restBoundaries).toEqual([]);
    expect(s.bufferMin).toBe(10);
    expect(usePlanPrefs.getState()).toMatchObject({
      workingWindow: { startMin: 480, endMin: 960 },
      hydrated: true,
    });
    // A later read returns the stored document, not localStorage.
    localStorage.setItem(
      'orbit-plan-prefs',
      JSON.stringify({ state: { workingWindow: { startMin: 0, endMin: 60 } } }),
    );
    expect((await loadSettings(repo, clock)).workingWindow).toEqual({ startMin: 480, endMin: 960 });
    expect(await repo.appSettings.count()).toBe(1);

    const saved = await saveSettings(repo, { eveningStartMin: 18 * 60 }, clock);
    expect(saved.eveningStartMin).toBe(18 * 60);
    expect(usePlanPrefs.getState().eveningStartMin).toBe(18 * 60);
    await expect(
      saveSettings(repo, { workingWindow: { startMin: 600, endMin: 600 } }, clock),
    ).rejects.toThrow();
  });
});

describe('PlanningSettings', () => {
  beforeEach(reset);

  it('rejects a working window that ends before it starts and saves a valid one', async () => {
    const user = userEvent.setup();
    const repo = createMemoryRepository({ clock });
    await loadSettings(repo, clock);
    renderWithProviders(<PlanningSettings clock={clock} />, {
      repository: repo,
      route: '/settings',
    });
    const start = screen.getByRole('textbox', { name: 'Working window start' });
    const end = screen.getByRole('textbox', { name: 'Working window end' });
    expect(start).toHaveValue('09:00');
    await user.clear(end);
    await user.type(end, '08:00');
    await user.click(screen.getByRole('button', { name: 'Save planning settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The day has to end after it starts.',
    );
    expect((await repo.appSettings.get(APP_SETTINGS_ID))?.workingWindow).toEqual({
      startMin: 540,
      endMin: 1080,
    });

    await user.clear(end);
    await user.type(end, '17:30');
    await user.click(screen.getByRole('button', { name: 'Remove rest 1' }));
    await user.click(screen.getByRole('button', { name: 'Add a rest boundary' }));
    const buffer = screen.getByLabelText(/Gap between blocks/);
    await user.clear(buffer);
    await user.type(buffer, '15');
    const evening = screen.getByLabelText(/Evening shutdown from/);
    await user.clear(evening);
    await user.type(evening, '18:30');
    await user.click(screen.getByRole('button', { name: 'Save planning settings' }));
    await waitFor(async () =>
      expect((await repo.appSettings.get(APP_SETTINGS_ID))?.workingWindow).toEqual({
        startMin: 540,
        endMin: 1050,
      }),
    );
    const stored = (await repo.appSettings.get(APP_SETTINGS_ID))!;
    expect(stored.restBoundaries).toEqual([{ startMin: 750, endMin: 795 }]);
    expect(stored.bufferMin).toBe(15);
    expect(stored.eveningStartMin).toBe(18 * 60 + 30);
    expect(usePlanPrefs.getState().bufferMin).toBe(15);
    expect(useToastStore.getState().toasts[0]?.title).toBe('Planning settings saved');
  });
});

describe('DataSettings', () => {
  beforeEach(reset);

  it('exports JSON or Markdown through the platform with the right file name', async () => {
    const user = userEvent.setup();
    const exportFile = vi.fn(async () => true);
    const platform: Platform = { ...webPlatform, exportFile };
    const repo = createMemoryRepository({ clock });
    const area = createRecord(AreaSchema, clock, { name: 'Study' });
    const project = createRecord(ProjectSchema, clock, { title: 'Thesis', areaId: area.id });
    await repo.areas.upsert(area);
    await repo.projects.upsert(project);
    for (const title of ['Meeting notes', 'Meeting notes', 'Meeting-notes']) {
      await repo.notes.upsert(
        createRecord(NoteSchema, clock, {
          title,
          projectId: project.id,
          body: 'An external link: [Example](https://example.com).',
        }),
      );
    }
    await repo.tasks.upsert(
      createRecord(TaskSchema, clock, {
        title: 'Write intro',
        projectId: project.id,
        areaId: area.id,
      }),
    );
    renderWithProviders(<DataSettings clock={clock} />, {
      repository: repo,
      platform,
      route: '/settings',
    });

    await user.click(screen.getByRole('button', { name: 'Export everything as JSON' }));
    await waitFor(() => expect(exportFile).toHaveBeenCalledTimes(1));
    const [jsonName, jsonBody] = exportFile.mock.calls[0] as unknown as [string, string];
    expect(jsonName).toBe('orbit-export-2026-09-14.json');
    expect(JSON.parse(jsonBody).data.areas).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Export as Markdown' }));
    await waitFor(() => expect(exportFile).toHaveBeenCalledTimes(2));
    const [mdName, mdBody, mime] = exportFile.mock.calls[1] as unknown as [string, string, string];
    expect(mdName).toBe('orbit-export-2026-09-14.md');
    expect(mime).toBe('text/markdown');
    expect(mdBody).toContain('<!-- projects/thesis.md -->');
    expect(mdBody).toContain('Write intro');
    const anchors = new Set([...mdBody.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1]));
    const links = [...mdBody.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThanOrEqual(7);
    expect(links.every((link) => anchors.has(link))).toBe(true);
    expect(mdBody).not.toMatch(/\]\((?:\.\.\/)?(?:projects|notes)\//);
    expect(mdBody).toContain('[Example](https://example.com)');
    expect(
      bundleMarkdown([
        { path: 'a.md', content: 'A\n' },
        { path: 'b.md', content: 'B' },
      ]),
    ).toBe(
      '<!-- a.md -->\n<a id="orbit-a_2e_md"></a>\n\nA\n\n---\n\n<!-- b.md -->\n<a id="orbit-b_2e_md"></a>\n\nB\n',
    );
  });

  it('import immediately updates planner preferences and the mounted planning form', async () => {
    const user = userEvent.setup();
    const source = createMemoryRepository({ clock: fixedClock(new Date(2026, 8, 14, 10)) });
    await saveSettings(source, {
      workingWindow: { startMin: 720, endMin: 1080 },
      defaultEstimateMin: 60,
    });
    const exported = serializeExport(await exportJson(source, clock));
    reset();
    const repo = createMemoryRepository({ clock });
    await loadSettings(repo, clock);
    renderWithProviders(
      <>
        <PlanningSettings clock={clock} />
        <DataSettings clock={clock} />
      </>,
      { repository: repo, route: '/settings' },
    );
    expect(screen.getByLabelText('Working window start')).toHaveValue('09:00');
    await user.upload(
      screen.getByLabelText('Orbit export file'),
      new File([exported], 'import.json', { type: 'application/json' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Confirm import' }));
    await waitFor(() => expect(screen.getByLabelText('Working window start')).toHaveValue('12:00'));
    expect(usePlanPrefs.getState().workingWindow).toEqual({ startMin: 720, endMin: 1080 });
    expect(usePlanPrefs.getState().defaultEstimateMin).toBe(60);
    await user.click(screen.getByRole('button', { name: 'Save planning settings' }));
    expect((await repo.appSettings.get(APP_SETTINGS_ID))!.workingWindow.startMin).toBe(720);
  });

  it('shows the dry-run counts before importing, then imports on confirm', async () => {
    const user = userEvent.setup();
    const source = createMemoryRepository({ clock });
    const world = seedWorld({
      seed: 3,
      sizes: { tasks: 6, notes: 1, events: 1, people: 1, days: 2 },
    });
    await source.transaction(async (tx) => {
      for (const a of world.areas) await tx.areas.upsert(a, { preserveUpdatedAt: true });
      for (const t of world.tasks) await tx.tasks.upsert(t, { preserveUpdatedAt: true });
    });
    const text = serializeExport(await exportJson(source, clock));
    const platform: Platform = {
      ...webPlatform,
      name: 'desktop',
      capabilities: { ...webPlatform.capabilities, dataFolder: true, nativeReminders: true },
      desktop: {
        dataFileStatus: () => null,
        pickDataFolder: async () => null,
        relocateData: async () => {},
        revealDataFolder: async () => {},
        pickExportFile: async () => text,
        listBackups: async () => [],
        restoreBackup: async () => {},
        hideCaptureWindow: async () => {},
        startDraggingWindow: async () => {},
        lastRun: async () => ({ crashedLastTime: false, startedAt: null, crash: null }),
        saveDiagnostics: async () => null,
        logEvent: async () => {},
        ...fakeResidentApi().api,
      },
    };
    const repo = createMemoryRepository({ clock });
    renderWithProviders(<DataSettings />, { repository: repo, platform, route: '/settings' });
    await user.click(screen.getByRole('button', { name: 'Choose a file…' }));
    const report = await screen.findByTestId('import-report');
    expect(within(report).getByTestId('import-create')).toHaveTextContent(
      String(world.areas.length + world.tasks.length),
    );
    expect(within(report).getByTestId('import-update')).toHaveTextContent('0');
    expect(await repo.tasks.count()).toBe(0); // nothing written yet

    await user.click(within(report).getByRole('button', { name: 'Confirm import' }));
    await waitFor(async () => expect(await repo.tasks.count()).toBe(world.tasks.length));
    expect(screen.queryByTestId('import-report')).not.toBeInTheDocument();
    expect(useToastStore.getState().toasts.at(-1)?.title).toBe('Import finished');
  });

  it('lists desktop backups newest first and restores one after confirming', async () => {
    const user = userEvent.setup();
    const backups: BackupCandidate[] = [
      {
        path: 'D:\\Orbit\\backups\\orbit-2026-09-10.db',
        modifiedAt: '2026-09-10T22:00:00.000Z',
        sizeBytes: 4096,
        kind: 'daily',
      },
      {
        path: 'D:\\Orbit\\backups\\orbit-2026-09-13.db',
        modifiedAt: '2026-09-13T22:00:00.000Z',
        sizeBytes: 8192,
        kind: 'weekly',
      },
    ];
    const restoreBackup = vi.fn(async () => {});
    const created: BackupCandidate = {
      path: 'D:\\Orbit\\backups\\manual-20260917T080000Z.db',
      modifiedAt: '2026-09-17T08:00:00.000Z',
      sizeBytes: 12288,
      kind: 'manual',
    };
    const backupNow = vi.fn(async () => {
      backups.push(created);
      return created;
    });
    const platform: Platform = {
      ...webPlatform,
      name: 'desktop',
      capabilities: { ...webPlatform.capabilities, dataFolder: true, nativeReminders: true },
      desktop: {
        dataFileStatus: () => ({
          dir: 'D:\\Orbit',
          path: 'D:\\Orbit\\orbit.db',
          integrity: { ok: true, messages: ['ok'], fts5: true },
          recovery: null,
        }),
        pickDataFolder: async () => null,
        relocateData: async () => {},
        revealDataFolder: async () => {},
        pickExportFile: async () => null,
        listBackups: async () => backups,
        restoreBackup,
        hideCaptureWindow: async () => {},
        startDraggingWindow: async () => {},
        lastRun: async () => ({ crashedLastTime: false, startedAt: null, crash: null }),
        saveDiagnostics: async () => null,
        logEvent: async () => {},
        ...fakeResidentApi({ backupNow }).api,
      },
    };
    renderWithProviders(<DataSettings />, { platform, route: '/settings' });
    const list = await screen.findByRole('list', { name: 'Backups' });
    expect(within(list).getByText('daily')).toBeInTheDocument();
    expect(within(list).getByText('weekly')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back up now' }));
    await waitFor(() => expect(backupNow).toHaveBeenCalledOnce());
    expect(await within(list).findByText('manual-20260917T080000Z.db')).toBeInTheDocument();
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('manual-20260917T080000Z.db');
    expect(rows[1]).toHaveTextContent('orbit-2026-09-13.db');
    expect(rows[1]).toHaveTextContent('8 KB');
    await user.click(within(list).getByRole('button', { name: 'Restore orbit-2026-09-10.db' }));
    await user.click(await screen.findByRole('button', { name: 'Restore and reload' }));
    await waitFor(() =>
      expect(restoreBackup).toHaveBeenCalledWith('D:\\Orbit\\backups\\orbit-2026-09-10.db'),
    );
  });
});

describe('ShortcutsReference', () => {
  it('lists the registry bindings grouped, plus the screen-bound ones', () => {
    const { registry } = renderWithProviders(<ShortcutsReference />, { route: '/settings' });
    registry.register('g t', () => {}, { description: 'Go to today', group: 'Navigation' });
    const { registry: r2 } = renderWithProviders(<ShortcutsReference />, {
      registry,
      route: '/settings',
    });
    expect(r2.list()).toHaveLength(1);
    const cards = screen.getAllByTestId('shortcuts');
    const card = cards[cards.length - 1]!;
    expect(within(card).getByText('Navigation')).toBeInTheDocument();
    expect(within(card).getByText('Go to today')).toBeInTheDocument();
    expect(within(card).getByText('Morning briefing')).toBeInTheDocument();
    expect(within(card).getByText('Pick the energy level')).toBeInTheDocument();
  });
});
