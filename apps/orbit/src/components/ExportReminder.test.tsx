import { createRecord, fixedClock, TaskSchema } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/app/store';
import { EXPORT_WATERMARK_KEY, readExportWatermark } from '@/features/settings/exportWatermark';
import { webPlatform, type Platform } from '@/platform';
import { renderWithProviders } from '@/test/render';
import { ExportReminder } from './ExportReminder';

const clock = fixedClock('2026-09-17T12:00:00.000Z');
const oldWatermark = { at: '2026-09-09T11:59:59.999Z', seq: 0 };

async function changedRepository() {
  const repo = createMemoryRepository({ clock });
  for (let index = 0; index < 101; index += 1) {
    await repo.tasks.upsert(createRecord(TaskSchema, clock, { title: `Task ${index}` }));
  }
  return repo;
}

function platformWith(dataFolder = false) {
  const exportFile = vi.fn<Platform['exportFile']>(async () => true);
  return {
    platform: {
      ...webPlatform,
      capabilities: { ...webPlatform.capabilities, dataFolder },
      exportFile,
    } satisfies Platform,
    exportFile,
  };
}

describe('ExportReminder', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useAppStore.setState({
      storageStatus: { persisted: true, usageBytes: null, quotaBytes: null },
      storageBannerDismissed: false,
      exportReminderDismissed: false,
    });
    localStorage.setItem(EXPORT_WATERMARK_KEY, JSON.stringify(oldWatermark));
  });

  it('shows the elapsed days and operations, and dismisses for the session', async () => {
    const user = userEvent.setup();
    const repo = await changedRepository();

    renderWithProviders(<ExportReminder clock={clock} />, { repository: repo });

    expect(await screen.findByTestId('export-reminder')).toHaveTextContent(
      '8 days and 101 changes',
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('export-reminder')).not.toBeInTheDocument();
    expect(useAppStore.getState().exportReminderDismissed).toBe(true);
    expect(sessionStorage.getItem('orbit-export-reminder-dismissed')).toBe('1');
  });

  it('exports JSON, advances the watermark, and hides', async () => {
    const user = userEvent.setup();
    const repo = await changedRepository();
    const { platform, exportFile } = platformWith();

    renderWithProviders(<ExportReminder clock={clock} />, { repository: repo, platform });
    await user.click(await screen.findByRole('button', { name: 'Export now' }));

    await waitFor(() => expect(exportFile).toHaveBeenCalledTimes(1));
    expect(exportFile).toHaveBeenCalledWith(
      'orbit-export-2026-09-17.json',
      expect.stringContaining('"opLogSeq": 101'),
    );
    expect(readExportWatermark()).toEqual({ at: '2026-09-17T12:00:00.000Z', seq: 101 });
    await waitFor(() => expect(screen.queryByTestId('export-reminder')).not.toBeInTheDocument());
  });

  it('does not stamp or hide when a save dialog is cancelled', async () => {
    const user = userEvent.setup();
    const repo = await changedRepository();
    const { platform, exportFile } = platformWith();
    exportFile.mockResolvedValue(false);

    renderWithProviders(<ExportReminder clock={clock} />, { repository: repo, platform });
    await user.click(await screen.findByRole('button', { name: 'Export now' }));

    await waitFor(() => expect(exportFile).toHaveBeenCalledTimes(1));
    expect(readExportWatermark()).toEqual(oldWatermark);
    expect(screen.getByTestId('export-reminder')).toBeInTheDocument();
  });

  it('never renders on desktop or while the storage warning is visible', async () => {
    const repo = await changedRepository();
    const desktop = platformWith(true);
    const first = renderWithProviders(<ExportReminder clock={clock} />, {
      repository: repo,
      platform: desktop.platform,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByTestId('export-reminder')).not.toBeInTheDocument();
    first.unmount();

    useAppStore.setState({
      storageStatus: { persisted: false, usageBytes: null, quotaBytes: null },
      storageBannerDismissed: false,
    });
    renderWithProviders(<ExportReminder clock={clock} />, { repository: repo });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByTestId('export-reminder')).not.toBeInTheDocument();
  });
});
