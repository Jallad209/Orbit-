import type { BackupCandidate, IntegrityResult, Repository } from '@orbit/storage';

/**
 * What the current runtime can do. The UI renders by these flags and never
 * sniffs the user agent or imports Tauri outside `src/platform/`.
 */
export interface PlatformCapabilities {
  /** Reminders fire while the window is closed (desktop tray). */
  backgroundReminders: boolean;
  /** The shell raises OS notifications for due reminders while Orbit runs (desktop scheduler). */
  nativeReminders: boolean;
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

/** What happened to the data file at startup (desktop only). */
export interface DataFileStatus {
  dir: string;
  path: string;
  integrity: IntegrityResult;
  /** When the file was corrupt: what was done about it. */
  recovery: null | { quarantinedTo: string; restoredFrom: string | null };
}

/** Desktop-only operations. Present when `capabilities.dataFolder` is true. */
export interface DesktopApi {
  dataFileStatus(): DataFileStatus | null;
  /** Native folder picker; returns the chosen folder or null when cancelled. */
  pickDataFolder(): Promise<string | null>;
  /** Copy and verify the live database, preserve the original, then switch folders and reload. */
  relocateData(dir: string): Promise<void>;
  revealDataFolder(): Promise<void>;
  /** Native file picker for an Orbit export; returns its text or null when cancelled. */
  pickExportFile(): Promise<string | null>;
  listBackups(): Promise<BackupCandidate[]>;
  /**
   * Verify the backup, preserve the current data in backups, atomically restore
   * through SQLite, and reload. Failures leave the original connection usable.
   */
  restoreBackup(backupPath: string): Promise<void>;
  hideCaptureWindow(): Promise<void>;
  /** Start dragging the frameless capture window. */
  startDraggingWindow(): Promise<void>;
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
  /** Desktop extras; undefined on the web. */
  readonly desktop?: DesktopApi;
}
