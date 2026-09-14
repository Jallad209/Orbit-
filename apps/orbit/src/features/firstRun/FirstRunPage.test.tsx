import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { AreaSchema, createRecord, fixedClock } from '@orbit/core';
import { createMemoryRepository, exportJson, serializeExport } from '@orbit/storage';
import { usePlanPrefs } from '@/features/today/planSettings';
import { webPlatform, type Platform } from '@/platform';
import { renderWithProviders } from '@/test/render';
import { fakeResidentApi } from '@/test/desktop';
import { AppRoutes } from '@/routes';
import { useToastStore } from '@/components/ui/toastStore';
import { FirstRunPage } from './FirstRunPage';
import { isFirstRunDone, markFirstRunDone, resetFirstRun } from './firstRun';

function desktopMock(overrides: Partial<NonNullable<Platform['desktop']>> = {}): Platform {
  return {
    ...webPlatform,
    name: 'desktop',
    capabilities: {
      backgroundReminders: false,
      nativeReminders: true,
      dataFolder: true,
      globalHotkey: true,
      tray: false,
    },
    desktop: {
      dataFileStatus: () => ({
        dir: 'C:\\Users\\me\\Orbit',
        path: 'C:\\Users\\me\\Orbit\\orbit.db',
        integrity: { ok: true, messages: ['ok'], fts5: true },
        recovery: null,
      }),
      pickDataFolder: vi.fn(async () => 'D:\\Sync\\Orbit'),
      relocateData: vi.fn(async () => {}),
      revealDataFolder: vi.fn(async () => {}),
      pickExportFile: vi.fn(async () => null),
      listBackups: vi.fn(async () => []),
      restoreBackup: vi.fn(async () => {}),
      hideCaptureWindow: vi.fn(async () => {}),
      startDraggingWindow: vi.fn(async () => {}),
      lastRun: vi.fn(async () => ({ crashedLastTime: false, startedAt: null, crash: null })),
      saveDiagnostics: vi.fn(async () => null),
      logEvent: vi.fn(async () => {}),
      ...fakeResidentApi().api,
      ...overrides,
    },
  };
}

function render(platform: Platform, repository = createMemoryRepository()) {
  return renderWithProviders(
    <Routes>
      <Route path="/welcome" element={<FirstRunPage />} />
      <Route path="/today" element={<h1>Today</h1>} />
    </Routes>,
    { route: '/welcome', platform, repository },
  );
}

describe('FirstRunPage', () => {
  beforeEach(() => {
    resetFirstRun();
    useToastStore.getState().clear();
    usePlanPrefs.setState({ workingWindow: { startMin: 540, endMin: 1080 } });
  });

  it.each(['/', '/today', '/settings'])('opens setup on a fresh desktop at %s', async (route) => {
    renderWithProviders(<AppRoutes />, { platform: desktopMock(), route });
    expect(await screen.findByRole('heading', { name: 'Welcome to Orbit' })).toBeInTheDocument();
  });

  it('finishes setup through the real routes without redirecting back', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { platform: desktopMock(), route: '/today' });
    await user.click(await screen.findByRole('button', { name: 'Start planning' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: /^(Today|Tomorrow)$/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('first-run')).not.toBeInTheDocument();
  });

  it('does not gate returning users or the quick-capture window', async () => {
    markFirstRunDone();
    const returning = renderWithProviders(<AppRoutes />, { platform: desktopMock(), route: '/' });
    expect(
      await screen.findByRole('heading', { level: 1, name: /^(Today|Tomorrow)$/ }),
    ).toBeInTheDocument();
    returning.unmount();
    resetFirstRun();
    renderWithProviders(<AppRoutes />, { platform: desktopMock(), route: '/capture' });
    expect(await screen.findByTestId('quick-capture-window')).toBeInTheDocument();
    expect(screen.queryByTestId('first-run')).not.toBeInTheDocument();
  });

  it('opens the web app without desktop setup', async () => {
    renderWithProviders(<AppRoutes />, { platform: webPlatform, route: '/' });
    expect(
      await screen.findByRole('heading', { level: 1, name: /^(Today|Tomorrow)$/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('first-run')).not.toBeInTheDocument();
  });

  it('shows a relocation error and keeps setup available', async () => {
    const user = userEvent.setup();
    render(
      desktopMock({
        relocateData: vi.fn(async () => {
          throw new Error('Choose another folder');
        }),
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Choose folder…' }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: 'Could not change data folder',
            description: 'Choose another folder',
          }),
        ]),
      ),
    );
    expect(screen.getByRole('button', { name: 'Choose folder…' })).toBeEnabled();
    expect(isFirstRunDone()).toBe(false);
  });

  it('persists the folder choice and the working window, then lands on Today', async () => {
    const user = userEvent.setup();
    const platform = desktopMock();
    render(platform);
    expect(screen.getByTestId('data-dir')).toHaveTextContent('C:\\Users\\me\\Orbit');

    await user.click(screen.getByRole('button', { name: 'Choose folder…' }));
    await waitFor(() =>
      expect(platform.desktop!.relocateData).toHaveBeenCalledWith('D:\\Sync\\Orbit'),
    );

    await user.clear(screen.getByRole('textbox', { name: 'Working window start' }));
    await user.type(screen.getByRole('textbox', { name: 'Working window start' }), '08:30');
    await user.clear(screen.getByRole('textbox', { name: 'Working window end' }));
    await user.type(screen.getByRole('textbox', { name: 'Working window end' }), '17:00');
    await user.click(screen.getByRole('button', { name: 'Start planning' }));

    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(usePlanPrefs.getState().workingWindow).toEqual({ startMin: 510, endMin: 1020 });
    expect(isFirstRunDone()).toBe(true);
  });

  it('refuses an inverted working window', async () => {
    const user = userEvent.setup();
    render(desktopMock());
    await user.clear(screen.getByRole('textbox', { name: 'Working window end' }));
    await user.type(screen.getByRole('textbox', { name: 'Working window end' }), '08:00');
    expect(screen.getByText('The day has to end after it starts.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start planning' })).toBeDisabled();
  });

  it('imports a browser export into the desktop repository', async () => {
    const user = userEvent.setup();
    const clock = fixedClock('2026-09-13T09:00:00.000Z');
    const source = createMemoryRepository({ clock });
    await source.areas.upsert(createRecord(AreaSchema, clock, { name: 'Study' }));
    const text = serializeExport(await exportJson(source, clock));
    const platform = desktopMock({ pickExportFile: vi.fn(async () => text) });
    const repository = createMemoryRepository({ clock });
    render(platform, repository);

    await user.click(screen.getByRole('button', { name: 'Import an Orbit export…' }));
    expect(await screen.findByTestId('import-result')).toHaveTextContent('1 added, 0 updated');
    expect(await repository.areas.count()).toBe(1);
  });
});
