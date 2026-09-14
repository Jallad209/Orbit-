import type { BackupCandidate, IntegrityResult, Repository, SearchService } from '@orbit/storage';

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

/** What the desktop shell knows about the previous run (the last-run marker). */
export interface LastRun {
  /** The previous run did not write its clean-exit marker. */
  crashedLastTime: boolean;
  startedAt: string | null;
  /** The panic hook's record, when the previous run panicked. Location and a redacted message only. */
  crash: { at: string; location: string; message: string } | null;
}

/** What the desktop puts in a diagnostics zip. */
export interface DiagnosticsBundle {
  path: string;
  files: string[];
  bytes: number;
}

/** Machine-local desktop preferences (week 11); never part of an export. */
export interface DesktopPrefs {
  closeToTray: boolean;
  closeExplanationSeen: boolean;
  autostart: boolean;
  legacyCloseMigrated: boolean;
}

/** Login launch as the OS actually has it, beside what the user asked for. */
export interface AutostartStatus {
  enabled: boolean;
  wanted: boolean;
  error: string | null;
  backend: 'os' | 'fake';
}

export type ResidentPhase = 'booting' | 'ready' | 'degraded' | 'quitting';

/** The shell's operational state, not a wish: what Settings shows. */
export interface ResidentStatus {
  phase: ResidentPhase;
  launch: 'manual' | 'background' | 'capture';
  trayAvailable: boolean;
  trayError: string | null;
  closeToTray: boolean;
  closeToTrayEffective: boolean;
  closeResolved: boolean;
  closeExplanationSeen: boolean;
  readyGeneration: number | null;
  generation: number;
  shutdownError: string | null;
  /** The main window is shown (hidden to the tray otherwise). */
  mainVisible: boolean;
}

/** Events the shell raises for the main window (and, for quit preparation, the capture window). */
export type ShellEvent =
  | 'orbit:navigate'
  | 'orbit:close-explain'
  | 'orbit:close-blocked'
  | 'orbit:quit-failed'
  | 'orbit:ready-timeout'
  | 'orbit:quitting'
  /** Quit (or an update) is about to start: save or discard drafts, then acknowledge. */
  | 'orbit:quit-prepare'
  /** A window refused or failed to acknowledge; the app stays reachable. */
  | 'orbit:quit-cancelled'
  /** A notification or protocol activation named a record to open (week 12). */
  | 'orbit:activate';

/** The payload of `orbit:quit-prepare`; the acknowledgment echoes both ids. */
export interface QuitPrepareRequest {
  requestId: number;
  generation: number;
}

/** Why a quit was cancelled, from the window that stopped it. */
export interface QuitCancelled {
  reason: string;
  /** Which window answered no, or "timeout" when one never answered. */
  window: string;
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
  /** The previous run's outcome, from the shell's last-run marker. */
  lastRun(): Promise<LastRun>;
  /**
   * Save a diagnostics zip (rolling logs, the report, the last-run marker)
   * through a save dialog. Null when the dialog was cancelled.
   */
  saveDiagnostics(report: unknown, defaultName: string): Promise<DiagnosticsBundle | null>;
  /** Forward one redacted diagnostic event to the shell's log file. */
  logEvent(level: string, kind: string, fields?: Record<string, number | boolean>): Promise<void>;
  /** The resident shell's state (week 11). */
  residentStatus(): Promise<ResidentStatus>;
  /**
   * The main window finished opening the data file, migrating settings and
   * preferences, and reconciling reminders: the shell may deliver for this
   * generation. Rejected from any other window or for a stale generation.
   */
  markReady(): Promise<void>;
  /**
   * Orderly shutdown regardless of the close preference. Every live window is
   * first asked to save or discard its drafts; a refusal cancels. `force`
   * skips that step — the user's explicit second decision to lose input.
   */
  quit(options?: { force?: boolean }): Promise<void>;
  /** Answer a quit-prepare request. Stale ids are ignored by the shell. */
  ackQuit(request: QuitPrepareRequest, ok: boolean, reason?: string): Promise<void>;
  /** Show and focus the capture window (a hidden capture with text asks before Quit). */
  showCaptureWindow(): Promise<void>;
  /** The capture window's bridge is listening; Quit waits for its acknowledgment. */
  captureSubscribed(): Promise<void>;
  showMain(): Promise<void>;
  /** Hide the main window (after the close explanation was acknowledged). */
  hideMain(): Promise<void>;
  /** Ask the native scheduler for a pass now (after reminder rows were written). */
  wakeScheduler(): Promise<void>;
  prefs: {
    get(): Promise<DesktopPrefs>;
    set(
      patch: Partial<Pick<DesktopPrefs, 'closeToTray' | 'closeExplanationSeen' | 'autostart'>>,
    ): Promise<DesktopPrefs>;
    /** Transfer the week-10 localStorage flag once; the raw value, or null when absent. */
    migrateLegacy(value: string | null): Promise<DesktopPrefs>;
  };
  autostart: {
    get(): Promise<AutostartStatus>;
    set(enabled: boolean): Promise<AutostartStatus>;
  };
  /** Subscribe to a shell event; resolves to the unsubscribe function. */
  onShellEvent<T = unknown>(name: ShellEvent, handler: (payload: T) => void): Promise<() => void>;
}

export interface Platform {
  readonly name: 'web' | 'desktop';
  readonly capabilities: PlatformCapabilities;
  /** Open the runtime's repository. Called once at startup. */
  createRepository(): Promise<Repository>;
  /**
   * The search index over that repository: FTS5 inside the data file when
   * the desktop's SQLite has it, MiniSearch in memory otherwise. Not built
   * until `ready()` is called, so opening never waits on it.
   */
  createSearchService(repository: Repository): Promise<SearchService>;
  /** Best-effort notification. In-app fallback is the caller's job. */
  notify(title: string, body?: string): Promise<boolean>;
  /** Hand the user a file: download on web, save dialog on desktop. */
  exportFile(fileName: string, contents: string | Blob, mimeType?: string): Promise<void>;
  /** Ask the runtime to keep data durable and report status. */
  requestPersistentStorage(): Promise<StorageStatus>;
  /** Desktop extras; undefined on the web. */
  readonly desktop?: DesktopApi;
}
