import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
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

  it('answers a quit at once when empty, and asks Save / Discard / Cancel when it holds text', async () => {
    const user = userEvent.setup();
    const fake = fakeResidentApi();
    const ackQuit = vi.fn(async () => {});
    const showCaptureWindow = vi.fn(async () => {});
    const captureSubscribed = vi.fn(async () => {});
    fake.api.ackQuit = ackQuit;
    fake.api.showCaptureWindow = showCaptureWindow;
    fake.api.captureSubscribed = captureSubscribed;
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
        hideCaptureWindow: async () => {},
        startDraggingWindow: async () => {},
        lastRun: async () => ({ crashedLastTime: false, startedAt: null, crash: null }),
        saveDiagnostics: async () => null,
        logEvent: async () => {},
        ...fake.api,
      },
    };
    const repository = createMemoryRepository();
    renderWithProviders(<QuickCaptureWindow />, { platform, repository, route: '/capture' });
    await waitFor(() => expect(captureSubscribed).toHaveBeenCalledTimes(1));

    // Empty: acknowledged without showing anything.
    act(() => fake.emit('orbit:quit-prepare', { requestId: 1, generation: 1 }));
    await waitFor(() =>
      expect(ackQuit).toHaveBeenCalledWith({ requestId: 1, generation: 1 }, true),
    );
    expect(showCaptureWindow).not.toHaveBeenCalled();

    // With text: the window comes forward and nothing is converted on its own.
    await user.type(screen.getByRole('textbox', { name: 'Capture' }), 'Call the bank');
    act(() => fake.emit('orbit:quit-prepare', { requestId: 2, generation: 1 }));
    const prompt = await screen.findByTestId('capture-quit-prompt');
    expect(prompt).toHaveTextContent('not saved yet');
    expect(showCaptureWindow).toHaveBeenCalledTimes(1);
    expect(await repository.captures.count()).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Cancel quit' }));
    await waitFor(() =>
      expect(ackQuit).toHaveBeenCalledWith(
        { requestId: 2, generation: 1 },
        false,
        'The quick capture window still holds text.',
      ),
    );
    expect(screen.getByRole('textbox', { name: 'Capture' })).toHaveValue('Call the bank');

    // Save capture writes the record and acknowledges.
    act(() => fake.emit('orbit:quit-prepare', { requestId: 3, generation: 1 }));
    await screen.findByTestId('capture-quit-prompt');
    await user.click(screen.getByRole('button', { name: 'Save capture' }));
    await waitFor(() =>
      expect(ackQuit).toHaveBeenCalledWith({ requestId: 3, generation: 1 }, true),
    );
    expect(await repository.captures.count()).toBe(1);
    expect(screen.getByRole('textbox', { name: 'Capture' })).toHaveValue('');
  });
});
