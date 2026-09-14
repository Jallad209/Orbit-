import { openRepository } from '@orbit/storage';
import type { Platform, StorageStatus } from './types';

/**
 * Browser runtime. Data lives in IndexedDB. If IndexedDB is unavailable
 * (some private modes, restricted contexts), fall back to memory so the app
 * still opens; the storage banner tells the user nothing will persist.
 */
export const webPlatform: Platform = {
  name: 'web',
  capabilities: {
    backgroundReminders: false,
    nativeReminders: false,
    dataFolder: false,
    globalHotkey: false,
    tray: false,
  },

  async createRepository() {
    if (typeof indexedDB === 'undefined') {
      // eslint-disable-next-line no-console -- surfaced for diagnostics; no logger yet (week 10)
      console.warn('IndexedDB unavailable; Orbit is running in memory only.');
      return openRepository({ kind: 'memory' });
    }
    return openRepository({ kind: 'indexeddb' });
  },

  async createSearchService(repository) {
    // The index library loads after the first paint, not with the app.
    const { createMiniSearchService } = await import('@orbit/storage/search/minisearch');
    return createMiniSearchService({ repo: repository });
  },

  async notify(title, body) {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission !== 'granted') return false;
    new Notification(title, body ? { body } : undefined);
    return true;
  },

  async exportFile(fileName, contents, mimeType = 'application/json') {
    const blob = contents instanceof Blob ? contents : new Blob([contents], { type: mimeType });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      // Give the browser a tick to start the download before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  },

  async openExternal(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  },

  async requestPersistentStorage(): Promise<StorageStatus> {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage) return { persisted: false, usageBytes: null, quotaBytes: null };
    let persisted: boolean;
    try {
      persisted = (await storage.persisted?.()) ?? false;
      if (!persisted && storage.persist) persisted = await storage.persist();
    } catch {
      persisted = false;
    }
    let usageBytes: number | null = null;
    let quotaBytes: number | null = null;
    try {
      const est = await storage.estimate?.();
      usageBytes = est?.usage ?? null;
      quotaBytes = est?.quota ?? null;
    } catch {
      /* estimate unsupported */
    }
    return { persisted, usageBytes, quotaBytes };
  },
};
