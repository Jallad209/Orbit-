import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { useAppStore } from '@/app/store';
import { useToastStore } from '@/components/ui/toastStore';
import { useDraftStore } from '@/features/drafts/draftStore';
import { webPlatform, type Platform } from '@/platform';
import { fakeResidentApi } from '@/test/desktop';
import { renderWithProviders } from '@/test/render';
import { DesktopSettings } from '@/features/settings/DesktopSettings';
import { LEGACY_CLOSE_KEY, ResidentBridge } from './ResidentBridge';

function desktopWith(fake: ReturnType<typeof fakeResidentApi>): Platform {
  return {
    ...webPlatform,
    name: 'desktop',
    capabilities: {
      backgroundReminders: true,
      nativeReminders: true,
      dataFolder: true,
      globalHotkey: true,
      tray: true,
    },
    desktop: {
      dataFileStatus: () => null,
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
      ...fake.api,
    },
  };
}

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

describe('ResidentBridge', () => {
  beforeEach(() => {
    localStorage.clear();
    useToastStore.getState().clear();
    useAppStore.setState({ quitting: false, reminderReconciles: 0 });
  });

  it('transfers the legacy close flag once, then acknowledges readiness after the first reconcile', async () => {
    localStorage.setItem(LEGACY_CLOSE_KEY, '0');
    const fake = fakeResidentApi({ prefsState: { legacyCloseMigrated: false } });
    const markReady = vi.fn(async () => {});
    fake.api.markReady = markReady;
    renderWithProviders(<ResidentBridge />, { platform: desktopWith(fake), insights: false });
    await waitFor(() => expect(fake.prefs.legacyCloseMigrated).toBe(true));
    expect(fake.prefs.closeToTray).toBe(false); // an explicit "0" stays off
    expect(markReady).not.toHaveBeenCalled();
    act(() => useAppStore.getState().noteReminderReconcile());
    await waitFor(() => expect(markReady).toHaveBeenCalledTimes(1));
    act(() => useAppStore.getState().noteReminderReconcile());
    await new Promise((r) => setTimeout(r, 20));
    expect(markReady).toHaveBeenCalledTimes(1);
  });

  it('routes tray navigation and shows the first-close explanation, hiding only after it is seen', async () => {
    const user = userEvent.setup();
    const fake = fakeResidentApi();
    const hideMain = vi.fn(async () => {});
    fake.api.hideMain = hideMain;
    renderWithProviders(
      <>
        <ResidentBridge />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </>,
      { platform: desktopWith(fake), insights: false, route: '/inbox' },
    );
    await waitFor(() => expect(fake.prefs.legacyCloseMigrated).toBe(true));
    act(() => fake.emit('orbit:navigate', '/today?regenerate=1'));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/today?regenerate=1'),
    );

    act(() => fake.emit('orbit:close-explain'));
    const dialog = await screen.findByTestId('close-explanation');
    expect(dialog).toHaveTextContent('Orbit keeps running in the tray');
    await user.click(screen.getByRole('button', { name: 'Hide to tray' }));
    await waitFor(() => expect(hideMain).toHaveBeenCalledTimes(1));
    expect(fake.prefs.closeExplanationSeen).toBe(true);

    act(() => fake.emit('orbit:close-blocked'));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.at(-1)?.title).toBe('Orbit is still starting'),
    );
    act(() => fake.emit('orbit:quit-failed', 'Orbit is still saving data.'));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        title: 'Orbit did not quit',
        description: 'Orbit is still saving data.',
      }),
    );
    act(() => fake.emit('orbit:quitting'));
    expect(useAppStore.getState().quitting).toBe(true);
  });
});

describe('DesktopSettings', () => {
  beforeEach(() => useToastStore.getState().clear());

  it('shows the operational state, saves close-to-tray, and reads login launch back from the OS', async () => {
    const user = userEvent.setup();
    const fake = fakeResidentApi();
    renderWithProviders(<DesktopSettings />, { platform: desktopWith(fake), insights: false });
    const status = await screen.findByTestId('resident-status');
    await waitFor(() => expect(status).toHaveTextContent('ready'));
    expect(screen.getByTestId('tray-status')).toHaveTextContent('tray icon shown');

    const close = screen.getByRole('switch', { name: /^Close to tray/ });
    await waitFor(() => expect(close).toBeChecked());
    await user.click(close);
    await waitFor(() => expect(fake.prefs.closeToTray).toBe(false));

    const login = screen.getByRole('switch', { name: /^Start Orbit at login/ });
    expect(login).not.toBeChecked();
    await user.click(login);
    await waitFor(() => expect(login).toBeChecked());
    expect(fake.autostart.enabled).toBe(true);
    expect(useToastStore.getState().toasts.at(-1)?.title).toBe('Orbit will start at login');
  });

  it('shows the real state and the error when the OS refuses, never an optimistic toggle', async () => {
    const user = userEvent.setup();
    const fake = fakeResidentApi();
    fake.api.autostart = {
      get: async () => ({ enabled: false, wanted: false, error: null, backend: 'os' }),
      set: async () => ({ enabled: false, wanted: true, error: 'Access is denied', backend: 'os' }),
    };
    renderWithProviders(<DesktopSettings />, { platform: desktopWith(fake), insights: false });
    const login = await screen.findByRole('switch', { name: /^Start Orbit at login/ });
    await waitFor(() => expect(login).toBeEnabled());
    await user.click(login);
    await waitFor(() =>
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        title: 'Login launch was not enabled',
        description: 'Access is denied',
      }),
    );
    expect(login).not.toBeChecked();
  });

  it('explains a missing tray and disables close-to-tray for the run', async () => {
    const fake = fakeResidentApi({
      residentStatus: async () => ({
        phase: 'ready',
        launch: 'manual',
        trayAvailable: false,
        trayError: 'no system tray',
        closeToTray: true,
        closeToTrayEffective: false,
        closeResolved: true,
        closeExplanationSeen: false,
        readyGeneration: 1,
        generation: 1,
        shutdownError: null,
        mainVisible: true,
      }),
    });
    renderWithProviders(<DesktopSettings />, { platform: desktopWith(fake), insights: false });
    expect(await screen.findByTestId('tray-error')).toHaveTextContent('no system tray');
    expect(screen.getByRole('switch', { name: /^Close to tray/ })).toBeDisabled();
  });

  it('saves registered drafts before a quit and acknowledges with the request ids', async () => {
    const fake = fakeResidentApi();
    const ackQuit = vi.fn(async () => {});
    fake.api.ackQuit = ackQuit;
    renderWithProviders(<ResidentBridge />, { platform: desktopWith(fake), insights: false });
    await waitFor(() => expect(fake.prefs.legacyCloseMigrated).toBe(true));
    const flush = vi.fn(async () => ({ ok: true as const }));
    useDraftStore.getState().register({
      key: 'note:1',
      label: 'Note “Budget”',
      dirty: true,
      status: 'editing',
      error: null,
      generation: 1,
      flush,
      discard: () => {},
    });
    await new Promise((r) => setTimeout(r, 10));
    act(() => fake.emit('orbit:quit-prepare', { requestId: 4, generation: 1 }));
    await waitFor(() => expect(ackQuit).toHaveBeenCalledTimes(1));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(ackQuit).toHaveBeenCalledWith({ requestId: 4, generation: 1 }, true, undefined);
    useDraftStore.setState({ drafts: {} });
  });

  it('refuses the quit with the reason when a draft cannot be saved, and offers discard-and-quit on cancellation', async () => {
    const user = userEvent.setup();
    const fake = fakeResidentApi();
    const ackQuit = vi.fn(async () => {});
    const quit = vi.fn(async () => {});
    fake.api.ackQuit = ackQuit;
    fake.api.quit = quit;
    renderWithProviders(<ResidentBridge />, { platform: desktopWith(fake), insights: false });
    await waitFor(() => expect(fake.prefs.legacyCloseMigrated).toBe(true));
    useDraftStore.getState().register({
      key: 'note:1',
      label: 'Note “Budget”',
      dirty: true,
      status: 'invalid',
      error: 'A title is required.',
      generation: 1,
      flush: async () => ({ ok: true }),
      discard: () => {},
    });
    await new Promise((r) => setTimeout(r, 10));
    act(() => fake.emit('orbit:quit-prepare', { requestId: 5, generation: 1 }));
    await waitFor(() => expect(ackQuit).toHaveBeenCalledTimes(1));
    expect(ackQuit).toHaveBeenCalledWith(
      { requestId: 5, generation: 1 },
      false,
      'Note “Budget”: A title is required.',
    );
    act(() =>
      fake.emit('orbit:quit-cancelled', {
        reason: 'Note “Budget”: A title is required.',
        window: 'main',
      }),
    );
    const toastEntry = await waitFor(() => {
      const t = useToastStore.getState().toasts.find((x) => x.id === 'quit-cancelled');
      expect(t).toBeDefined();
      return t!;
    });
    expect(toastEntry.title).toBe('Orbit did not quit');
    expect(toastEntry.action?.label).toBe('Discard unsaved changes and quit');
    act(() => toastEntry.action?.onClick());
    await waitFor(() => expect(quit).toHaveBeenCalledWith({ force: true }));
    void user;
    useDraftStore.setState({ drafts: {} });
  });

  it('on the web says none of this exists', () => {
    renderWithProviders(<DesktopSettings />, { insights: false });
    expect(screen.getByTestId('desktop-unsupported')).toHaveTextContent('only in the desktop app');
  });
});
