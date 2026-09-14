import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { createMemoryRepository } from '@orbit/storage';
import { createMiniSearchService } from '@orbit/storage/search/minisearch';
import type { Repository, SearchService } from '@orbit/storage';
import type { Clock, CommandRegistry } from '@orbit/core';
import { InsightsProvider } from '@/features/insights/InsightsProvider';
import { CommandRegistryProvider } from '@/features/palette/commandRegistry';
import { SearchProvider } from '@/features/search/SearchProvider';
import { HotkeyRegistry } from '@/lib/hotkeys';
import { HotkeyProvider } from '@/lib/HotkeyProvider';
import { TooltipProvider } from '@/components/ui/Popover';
import { PlatformProvider, webPlatform, type Platform } from '@/platform';

interface Options extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  repository?: Repository;
  platform?: Platform;
  registry?: HotkeyRegistry;
  /** A command registry with its own undo stack; a fresh one per render by default. */
  commands?: CommandRegistry;
  /** The search index; MiniSearch over the repository by default, `false` for none at all. */
  search?: SearchService | false;
  /** The shared insight computation, as the app shell mounts it; `false` to leave it out. */
  insights?: false;
  /** The clock the shared providers read; the system clock by default. */
  clock?: Clock;
}

/** Render inside router, platform, and hotkey providers with an in-memory repository. */
export function renderWithProviders(ui: ReactElement, options: Options = {}) {
  const repository = options.repository ?? createMemoryRepository();
  const registry = options.registry ?? new HotkeyRegistry();
  const platform = options.platform ?? webPlatform;
  const search =
    options.search === false
      ? null
      : (options.search ?? createMiniSearchService({ repo: repository }));

  function Wrapper({ children }: { children: ReactNode }) {
    const routed = (
      <MemoryRouter initialEntries={[options.route ?? '/today']}>
        <HotkeyProvider registry={registry}>{children}</HotkeyProvider>
      </MemoryRouter>
    );
    const inner = (
      <CommandRegistryProvider registry={options.commands}>
        <TooltipProvider delayDuration={0}>
          {options.insights === false ? (
            routed
          ) : (
            <InsightsProvider clock={options.clock}>{routed}</InsightsProvider>
          )}
        </TooltipProvider>
      </CommandRegistryProvider>
    );
    return (
      <PlatformProvider platform={platform} repository={repository}>
        {search ? <SearchProvider service={search}>{inner}</SearchProvider> : inner}
      </PlatformProvider>
    );
  }

  return {
    ...render(ui, { ...options, wrapper: Wrapper }),
    repository,
    registry,
    platform,
    search,
  };
}
