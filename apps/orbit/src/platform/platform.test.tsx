import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { Platform } from './types';
import { PlatformProvider, usePlatform, useRepository, webPlatform } from './index';

function Probe() {
  const platform = usePlatform();
  const repo = useRepository();
  return (
    <div>
      <span data-testid="name">{platform.name}</span>
      <span data-testid="reminders">{String(platform.capabilities.backgroundReminders)}</span>
      <span data-testid="has-repo">{String(typeof repo.tasks.list === 'function')}</span>
    </div>
  );
}

describe('web platform', () => {
  it('reports browser-only capabilities honestly', () => {
    expect(webPlatform.name).toBe('web');
    expect(webPlatform.capabilities).toEqual({
      backgroundReminders: false,
      nativeReminders: false,
      dataFolder: false,
      globalHotkey: false,
      tray: false,
    });
  });

  it('opens a repository once and provides it through context', async () => {
    render(
      <PlatformProvider fallback={<p>loading</p>}>
        <Probe />
      </PlatformProvider>,
    );
    expect(screen.getByText('loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('has-repo')).toHaveTextContent('true'));
    expect(screen.getByTestId('name')).toHaveTextContent('web');
    expect(screen.getByTestId('reminders')).toHaveTextContent('false');
  });

  it('reuses an in-flight open during Strict Mode and leaves desktop closure to Rust', async () => {
    const repository = await webPlatform.createRepository();
    const close = vi.spyOn(repository, 'close');
    const createRepository = vi.fn(async () => repository);
    const platform: Platform = {
      ...webPlatform,
      name: 'desktop',
      createRepository,
    };

    const view = render(
      <StrictMode>
        <PlatformProvider platform={platform} fallback={<p>loading</p>}>
          <Probe />
        </PlatformProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByTestId('has-repo')).toHaveTextContent('true'));
    expect(createRepository).toHaveBeenCalledTimes(1);

    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(close).not.toHaveBeenCalled();
    await repository.close();
  });

  it('reports storage status without throwing when APIs are missing', async () => {
    const status = await webPlatform.requestPersistentStorage();
    expect(typeof status.persisted).toBe('boolean');
  });
});
