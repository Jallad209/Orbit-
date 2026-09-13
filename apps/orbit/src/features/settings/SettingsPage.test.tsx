import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { useAppStore } from '@/app/store';
import { webPlatform, type Platform } from '@/platform';
import { renderWithProviders } from '@/test/render';
import { SettingsPage } from './SettingsPage';

const desktop: Platform = {
  ...webPlatform,
  name: 'desktop',
  capabilities: { backgroundReminders: true, dataFolder: true, globalHotkey: true, tray: false },
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
    hideCaptureWindow: vi.fn(async () => {}),
    startDraggingWindow: vi.fn(async () => {}),
  },
};

describe('SettingsPage capability messaging', () => {
  beforeEach(() => {
    useAppStore.setState({
      storageStatus: { persisted: false, usageBytes: 1024, quotaBytes: null },
    });
  });

  it('on the web says reminders only fire while open and shows the storage status', () => {
    renderWithProviders(<SettingsPage />, { platform: webPlatform, route: '/settings' });
    expect(screen.getByTestId('reminders-note')).toHaveTextContent('only while Orbit is open');
    expect(screen.getByTestId('hotkey-note')).toHaveTextContent('while Orbit is focused');
    expect(screen.getByTestId('web-storage')).toHaveTextContent('not guaranteed');
    expect(screen.queryByTestId('integrity')).not.toBeInTheDocument();
  });

  it('on desktop shows the data folder, integrity, recovery, and background reminders', () => {
    renderWithProviders(<SettingsPage />, { platform: desktop, route: '/settings' });
    expect(screen.getByTestId('reminders-note')).toHaveTextContent('while the window is closed');
    expect(screen.getByTestId('hotkey-note')).toHaveTextContent('from any app');
    expect(screen.getByTestId('data-dir')).toHaveTextContent('D:\\Orbit');
    expect(screen.getByTestId('integrity')).toHaveTextContent('ok');
    expect(screen.getByTestId('integrity')).toHaveTextContent('FTS5');
    expect(screen.getByTestId('recovery')).toHaveTextContent('no backup was available');
    expect(screen.queryByTestId('web-storage')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Close to tray/ })).toBeInTheDocument();
  });
});
