import type { Repository } from '@orbit/storage';

/**
 * What the current runtime can do. The UI renders by these flags and never
 * sniffs the user agent or imports Tauri outside `src/platform/`.
 */
export interface PlatformCapabilities {
  /** Reminders fire while the window is closed (desktop tray). */
  backgroundReminders: boolean;
  /** Data lives in a user-chosen folder as a real file (desktop SQLite). */
  dataFolder: boolean;
  /** System-wide quick-capture shortcut. */
  globalHotkey: boolean;
  /** Tray icon and close-to-tray. */
  tray: boolean;
}

export interface StorageStatus {
  /** Browser granted persistent storage, or desktop (always true). */
  persisted: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
}

export interface Platform {
  readonly name: 'web' | 'desktop';
  readonly capabilities: PlatformCapabilities;
  /** Open the runtime's repository. Called once at startup. */
  createRepository(): Promise<Repository>;
  /** Best-effort notification. In-app fallback is the caller's job. */
  notify(title: string, body?: string): Promise<boolean>;
  /** Hand the user a file: download on web, save dialog on desktop. */
  exportFile(fileName: string, contents: string | Blob, mimeType?: string): Promise<void>;
  /** Ask the runtime to keep data durable and report status. */
  requestPersistentStorage(): Promise<StorageStatus>;
}
