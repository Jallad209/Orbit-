import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '@/app/store';
import { webPlatform, type Platform } from '@/platform';
import { renderWithProviders } from '@/test/render';
import { StorageBanner } from './StorageBanner';

function platformWith(persisted: boolean, dataFolder = false): Platform {
  return {
    ...webPlatform,
    capabilities: { ...webPlatform.capabilities, dataFolder },
    async requestPersistentStorage() {
      return { persisted, usageBytes: 2 * 1024 * 1024, quotaBytes: null };
    },
  };
}

describe('StorageBanner', () => {
  beforeEach(() => {
    useAppStore.setState({ storageStatus: null, storageBannerDismissed: false });
  });

  it('warns when the browser refuses persistent storage and can be dismissed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StorageBanner />, { platform: platformWith(false) });
    const banner = await screen.findByTestId('storage-banner');
    expect(banner).toHaveTextContent('has not promised to keep');
    expect(banner).toHaveTextContent('Using 2.0 MB');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('storage-banner')).not.toBeInTheDocument();
  });

  it('stays hidden when storage is persisted', async () => {
    renderWithProviders(<StorageBanner />, { platform: platformWith(true) });
    await waitFor(() => expect(useAppStore.getState().storageStatus?.persisted).toBe(true));
    expect(screen.queryByTestId('storage-banner')).not.toBeInTheDocument();
  });

  it('never renders on a runtime with a data folder (desktop)', async () => {
    renderWithProviders(<StorageBanner />, { platform: platformWith(false, true) });
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('storage-banner')).not.toBeInTheDocument();
    expect(useAppStore.getState().storageStatus).toBeNull();
  });
});
