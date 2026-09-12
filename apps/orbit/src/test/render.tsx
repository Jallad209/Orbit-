import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { createMemoryRepository } from '@orbit/storage';
import type { Repository } from '@orbit/storage';
import { HotkeyRegistry } from '@/lib/hotkeys';
import { HotkeyProvider } from '@/lib/HotkeyProvider';
import { PlatformProvider, webPlatform, type Platform } from '@/platform';

interface Options extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  repository?: Repository;
  platform?: Platform;
  registry?: HotkeyRegistry;
}

/** Render inside router, platform, and hotkey providers with an in-memory repository. */
export function renderWithProviders(ui: ReactElement, options: Options = {}) {
  const repository = options.repository ?? createMemoryRepository();
  const registry = options.registry ?? new HotkeyRegistry();
  const platform = options.platform ?? webPlatform;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <PlatformProvider platform={platform} repository={repository}>
        <MemoryRouter initialEntries={[options.route ?? '/today']}>
          <HotkeyProvider registry={registry}>{children}</HotkeyProvider>
        </MemoryRouter>
      </PlatformProvider>
    );
  }

  return { ...render(ui, { ...options, wrapper: Wrapper }), repository, registry, platform };
}
