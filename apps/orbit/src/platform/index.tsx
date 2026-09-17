import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Repository } from '@orbit/storage';
import { desktopPlatform } from './desktop';
import { isTauri, repositoryKindFor } from './select';
import type { Platform } from './types';
import { webPlatform } from './web';

export type {
  DataFileStatus,
  DesktopApi,
  Platform,
  PlatformCapabilities,
  StorageStatus,
} from './types';
export { webPlatform, desktopPlatform, isTauri, repositoryKindFor };

/** The runtime Orbit is running in: Tauri's WebView or a browser. */
export function detectPlatform(): Platform {
  return isTauri() ? desktopPlatform : webPlatform;
}

interface PlatformContextValue {
  platform: Platform;
  repository: Repository;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

interface PlatformProviderProps {
  platform?: Platform;
  /** Supply a ready repository (tests). Otherwise `platform.createRepository()` runs once. */
  repository?: Repository;
  fallback?: ReactNode;
  children: ReactNode;
}

interface OwnedRepository {
  platform: Platform;
  promise: Promise<Repository>;
  closeTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Selects the runtime and opens its repository once. Everything below reads
 * `usePlatform()` and `useRepository()`; nothing imports Tauri or Dexie directly.
 */
export function PlatformProvider({
  platform = detectPlatform(),
  repository,
  fallback = null,
  children,
}: PlatformProviderProps) {
  const [opened, setOpened] = useState<Repository | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const owned = useRef<OwnedRepository | null>(null);

  useEffect(() => {
    if (repository) return; // caller owns the repository's lifecycle
    let active = true;
    let resource = owned.current;
    if (!resource || resource.platform !== platform) {
      resource = {
        platform,
        promise: platform.createRepository(),
        closeTimer: null,
      };
      owned.current = resource;
      setOpened(null);
      setError(null);
    }
    if (resource.closeTimer !== null) {
      clearTimeout(resource.closeTimer);
      resource.closeTimer = null;
    }
    resource.promise
      .then((r) => {
        if (active) setOpened(r);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      active = false;
      // Strict Mode immediately replays effects in development. Deferring disposal
      // lets that replay reclaim the same in-flight open instead of closing under it.
      resource.closeTimer = setTimeout(() => {
        resource.closeTimer = null;
        // SQLite belongs to the resident Tauri process and is shared by both
        // webviews. Rust closes it during the existing orderly shutdown path.
        if (resource.platform.name !== 'desktop') {
          void resource.promise.then((r) => r.close()).catch(() => undefined);
        }
        if (owned.current === resource) owned.current = null;
      }, 0);
    };
  }, [platform, repository]);

  const repo = repository ?? opened;
  const value = useMemo(() => (repo ? { platform, repository: repo } : null), [platform, repo]);

  if (error) {
    return (
      <div role="alert" className="p-6 text-danger">
        Orbit could not open its data store: {error.message}
      </div>
    );
  }
  if (!value) return <>{fallback}</>;
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): Platform {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error('usePlatform must be used inside <PlatformProvider>');
  return ctx.platform;
}

export function useRepository(): Repository {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error('useRepository must be used inside <PlatformProvider>');
  return ctx.repository;
}
