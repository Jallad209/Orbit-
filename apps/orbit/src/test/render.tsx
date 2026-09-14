import { render, type RenderOptions } from '@testing-library/react';
import { createContext, useContext, useState, type ReactElement, type ReactNode } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { createMemoryRepository } from '@orbit/storage';
import { createMiniSearchService } from '@orbit/storage/search/minisearch';
import type { Repository, SearchService } from '@orbit/storage';
import type { Clock, CommandRegistry } from '@orbit/core';
import { DraftGuard } from '@/features/drafts/DraftGuard';
import { InsightsProvider } from '@/features/insights/InsightsProvider';
import { CommandRegistryProvider } from '@/features/palette/commandRegistry';
import { SearchProvider } from '@/features/search/SearchProvider';
import { HotkeyRegistry } from '@/lib/hotkeys';
import { HotkeyProvider } from '@/lib/HotkeyProvider';
import { TooltipProvider } from '@/components/ui/Popover';
import { PlatformProvider, webPlatform, type Platform } from '@/platform';

const ChildrenContext = createContext<ReactNode>(null);
function RoutedChildren() {
  return <>{useContext(ChildrenContext)}</>;
}

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
    // The same shape as the app: a data router with one catch-all route hosting the tree, so
    // the draft guard's blocker works under test exactly as it does in the shell. The children
    // reach the route through context so a rerender with new children still updates.
    const [router] = useState(() =>
      createMemoryRouter(
        [
          {
            path: '*',
            element: (
              <HotkeyProvider registry={registry}>
                <RoutedChildren />
                <DraftGuard />
              </HotkeyProvider>
            ),
          },
        ],
        { initialEntries: [options.route ?? '/today'] },
      ),
    );
    const routed = (
      <ChildrenContext.Provider value={children}>
        <RouterProvider router={router} />
      </ChildrenContext.Provider>
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
