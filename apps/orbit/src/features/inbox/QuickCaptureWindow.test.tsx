import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRepository } from '@orbit/storage';
import { webPlatform, type Platform } from '@/platform';
import { renderWithProviders } from '@/test/render';
import { fakeResidentApi } from '@/test/desktop';
import { QuickCaptureWindow } from './QuickCaptureWindow';

describe('QuickCaptureWindow', () => {
  it('submits through the shared CaptureBar and hides the window; Escape hides too', async () => {
    const user = userEvent.setup();
    const hideCaptureWindow = vi.fn(async () => {});
    const platform: Platform = {
      ...webPlatform,
      name: 'desktop',
      capabilities: {
        backgroundReminders: true,
        nativeReminders: true,
        dataFolder: true,
        globalHotkey: true,
        tray: false,
      },
      desktop: {
        dataFileStatus: () => null,
        pickDataFolder: async () => null,
        relocateData: async () => {},
        revealDataFolder: async () => {},
        pickExportFile: async () => null,
        listBackups: async () => [],
        restoreBackup: async () => {},
        hideCaptureWindow,
        startDraggingWindow: async () => {},
        lastRun: async () => ({ crashedLastTime: false, startedAt: null, crash: null }),
        saveDiagnostics: async () => null,
        logEvent: async () => {},
        ...fakeResidentApi().api,
      },
    };
    const repository = createMemoryRepository();
    renderWithProviders(<QuickCaptureWindow />, { platform, repository, route: '/capture' });

    const box = screen.getByRole('textbox', { name: 'Capture' });
    expect(box).toHaveFocus();
    await user.type(box, 'Pay rent every month{Enter}');
    await waitFor(async () => expect(await repository.captures.count()).toBe(1));
    expect((await repository.captures.list())[0]?.type).toBe('bill');
    expect(hideCaptureWindow).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(hideCaptureWindow).toHaveBeenCalledTimes(2);
  });
});
