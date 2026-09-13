import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('reports storage status without throwing when APIs are missing', async () => {
    const status = await webPlatform.requestPersistentStorage();
    expect(typeof status.persisted).toBe('boolean');
  });
});
