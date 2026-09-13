import type { Platform } from './types';

/** True inside the Tauri WebView. The only runtime sniff in the app. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Storage kind a platform must open: the factory's decision, made testable. */
export function repositoryKindFor(
  platform: Pick<Platform, 'capabilities'>,
): 'sqlite' | 'indexeddb' {
  return platform.capabilities.dataFolder ? 'sqlite' : 'indexeddb';
}
