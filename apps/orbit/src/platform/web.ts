import { createMemoryRepository } from '@orbit/storage';
import type { Platform, StorageStatus } from './types';

/**
 * Browser runtime. Week 1 uses the in-memory repository; week 2 swaps in
 * IndexedDB through the storage factory without touching the UI.
 */
export const webPlatform: Platform = {
  name: 'web',
  capabilities: {
    backgroundReminders: false,
    dataFolder: false,
    globalHotkey: false,
    tray: false,
  },

  async createRepository() {
    return createMemoryRepository();
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
