import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '@/app/store';
import { webPlatform, type Platform } from '@/platform';
import { renderWithProviders } from '@/test/render';
import { SettingsPage } from './SettingsPage';
import { useToastStore } from '@/components/ui/toastStore';

const desktop: Platform = {
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
      dir: 'D:\\Orbit',
      path: 'D:\\Orbit\\orbit.db',
      integrity: { ok: true, messages: ['ok'], fts5: true },
      recovery: { quarantinedTo: 'D:\\Orbit\\orbit.corrupt-1.db', restoredFrom: null },
    }),
    pickDataFolder: vi.fn(async () => null),
    relocateData: vi.fn(async () => {}),
    revealDataFolder: vi.fn(async () => {}),
    pickExportFile: vi.fn(async () => null),
    listBackups: vi.fn(async () => []),
    restoreBackup: vi.fn(async () => {}),
    hideCaptureWindow: vi.fn(async () => {}),
    startDraggingWindow: vi.fn(async () => {}),
  },
};

describe('SettingsPage capability messaging', () => {
  beforeEach(() => {
    useToastStore.getState().clear();
    useAppStore.setState({
      storageStatus: { persisted: false, usageBytes: 1024, quotaBytes: null },
    });
  });

  it('on the web says scheduled reminders are unavailable and shows the storage status', () => {
    renderWithProviders(<SettingsPage />, { platform: webPlatform, route: '/settings' });
    expect(screen.getByTestId('reminders-note')).toHaveTextContent(
      'inside Orbit while this tab is open',
    );
    expect(screen.getByTestId('hotkey-note')).toHaveTextContent('while Orbit is focused');
    expect(screen.getByTestId('web-storage')).toHaveTextContent('not guaranteed');
    expect(screen.queryByTestId('integrity')).not.toBeInTheDocument();
  });

  it('on desktop shows data safety status and does not promise reminders or a tray', () => {
    renderWithProviders(<SettingsPage />, { platform: desktop, route: '/settings' });
    expect(screen.getByTestId('reminders-note')).toHaveTextContent('while Orbit is running');
    expect(screen.getByTestId('hotkey-note')).toHaveTextContent('from any app');
    expect(screen.getByTestId('data-dir')).toHaveTextContent('D:\\Orbit');
    expect(screen.getByTestId('integrity')).toHaveTextContent('ok');
    expect(screen.getByTestId('integrity')).toHaveTextContent('FTS5');
    expect(screen.getByTestId('recovery')).toHaveTextContent('no backup was available');
    expect(screen.queryByTestId('web-storage')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Close to tray/ })).toBeDisabled();
  });

  it('reports a failed folder change and lets the user try again', async () => {
    const user = userEvent.setup();
    const platform = {
      ...desktop,
      desktop: {
        ...desktop.desktop!,
        pickDataFolder: async () => 'D:\\Existing',
        relocateData: async () => {
          throw new Error('That folder already contains an Orbit database');
        },
      },
    };
    renderWithProviders(<SettingsPage />, { platform, route: '/settings' });
    await user.click(screen.getByRole('button', { name: 'Change…' }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: 'Could not change data folder',
            description: expect.stringContaining('already contains'),
          }),
        ]),
      ),
    );
    expect(screen.getByTestId('data-dir')).toHaveTextContent('D:\\Orbit');
    expect(screen.getByRole('button', { name: 'Change…' })).toBeEnabled();
  });
});
