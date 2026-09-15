import { chooseRestore, createSearchService, integrityCheck, openRepository } from '@orbit/storage';
import type { BackupCandidate, Repository, SqlDriver } from '@orbit/storage';
import { recordEvent } from '@/lib/diagnostics';
import { tauriSqlDriver, type Invoke } from './tauriSqlDriver';
import type {
  AutostartStatus,
  DataFileStatus,
  DesktopApi,
  DesktopPrefs,
  DiagnosticsBundle,
  LastRun,
  Platform,
  QuitPrepareRequest,
  ResidentStatus,
  ShellEvent,
  StorageStatus,
} from './types';

/**
 * Desktop runtime on Tauri. Data is a SQLite file in a user-chosen folder,
 * driven through Rust commands. The Tauri packages are imported lazily so
 * the web bundle never carries them.
 */
export const DATA_FILE = 'orbit.db';

interface Deps {
  invoke: Invoke;
  join(...parts: string[]): Promise<string>;
  openDialog(options: {
    directory?: boolean;
    multiple?: false;
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | null>;
  saveDialog(options: { defaultPath?: string; title?: string }): Promise<string | null>;
  notification: {
    isPermissionGranted(): Promise<boolean>;
    requestPermission(): Promise<string>;
    send(options: { title: string; body?: string }): void;
  };
  window: { startDragging(): Promise<void> };
  /** The opener plugin: the OS handler for a URL. */
  openUrl(url: string): Promise<void>;
  reload(): void;
  /** Subscribe to a shell event; resolves to the unsubscribe function. */
  listen<T>(name: string, handler: (payload: T) => void): Promise<() => void>;
}

async function loadDeps(): Promise<Deps> {
  const [core, path, dialog, notification, win, event, opener] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/path'),
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-notification'),
    import('@tauri-apps/api/window'),
    import('@tauri-apps/api/event'),
    import('@tauri-apps/plugin-opener'),
  ]);
  return {
    invoke: core.invoke as Invoke,
    join: path.join,
    openDialog: (o) => dialog.open(o) as Promise<string | null>,
    saveDialog: (o) => dialog.save(o),
    notification: {
      isPermissionGranted: notification.isPermissionGranted,
      requestPermission: notification.requestPermission,
      send: notification.sendNotification,
    },
    window: { startDragging: () => win.getCurrentWindow().startDragging() },
    openUrl: (url) => opener.openUrl(url),
    reload: () => window.location.reload(),
    listen: (name, handler) => event.listen(name, (e) => handler(e.payload as never)),
  };
}

/**
 * Open the data file, run the integrity check, and recover when the file is
 * corrupt: quarantine it, restore the newest backup if there is one, and
 * open again. Pure of Tauri so tests can drive it with a fake `deps`.
 */
export async function openDesktopRepository(deps: Pick<Deps, 'invoke' | 'join'>): Promise<{
  repository: Repository;
  status: DataFileStatus;
  generation: number;
  driver: SqlDriver;
}> {
  const { invoke, join } = deps;
  let dir = await invoke<string | null>('data_dir_get');
  if (!dir)
    dir = await invoke<string>('data_dir_set', { path: await invoke<string>('data_dir_default') });
  const path = await join(dir, DATA_FILE);

  const open = async () => {
    const generation = (await invoke<number>('db_open', { path })) ?? 0;
    const driver = tauriSqlDriver(invoke, generation);
    return { driver, integrity: await integrityCheck(driver), generation };
  };

  let { driver, integrity, generation } = await open();
  let recovery: DataFileStatus['recovery'] = null;
  if (!integrity.ok) {
    await driver.close();
    const quarantinedTo = await invoke<string>('data_quarantine', { path });
    const backup = chooseRestore(await invoke<BackupCandidate[]>('data_backups', { path: dir }));
    if (backup) await invoke<void>('data_restore', { from: backup.path, to: path });
    recovery = { quarantinedTo, restoredFrom: backup?.path ?? null };
    ({ driver, integrity, generation } = await open());
  }

  const repository = await openRepository({ kind: 'sqlite', driver });
  return { repository, status: { dir, path, integrity, recovery }, generation, driver };
}

export function createDesktopPlatform(load: () => Promise<Deps> = loadDeps): Platform {
  let deps: Deps | null = null;
  let status: DataFileStatus | null = null;
  let generation = 0;
  let driver: SqlDriver | null = null;
  const ready = async () => (deps ??= await load());

  const desktop: DesktopApi = {
    dataFileStatus: () => status,
    async pickDataFolder() {
      const d = await ready();
      return d.openDialog({ directory: true, title: 'Choose where Orbit keeps its data' });
    },
    async relocateData(dir) {
      const d = await ready();
      await d.invoke<string>('data_dir_relocate', { path: dir });
      d.reload();
    },
    async revealDataFolder() {
      const d = await ready();
      if (status) await d.invoke<void>('data_dir_reveal', { path: status.dir });
    },
    async pickExportFile() {
      const d = await ready();
      const file = await d.openDialog({
        title: 'Open an Orbit export',
        filters: [{ name: 'Orbit export', extensions: ['json'] }],
      });
      if (!file) return null;
      return d.invoke<string>('file_read_text', { path: file });
    },
    async listBackups() {
      const d = await ready();
      return status ? d.invoke<BackupCandidate[]>('data_backups', { path: status.dir }) : [];
    },
    async restoreBackup(backupPath) {
      const d = await ready();
      if (!status) throw new Error('The data file is not open.');
      await d.invoke<string>('data_restore_backup', { from: backupPath, generation });
      d.reload();
    },
    async hideCaptureWindow() {
      const d = await ready();
      await d.invoke<void>('capture_hide');
    },
    async startDraggingWindow() {
      const d = await ready();
      await d.window.startDragging();
    },
    async lastRun() {
      const d = await ready();
      return d.invoke<LastRun>('diagnostics_last_run');
    },
    async saveDiagnostics(report, defaultName) {
      const d = await ready();
      const path = await d.saveDialog({
        defaultPath: defaultName,
        title: 'Save diagnostics bundle',
      });
      if (!path) return null;
      return d.invoke<DiagnosticsBundle>('diagnostics_export', { path, report });
    },
    async logEvent(level, kind, fields) {
      const d = await ready();
      await d.invoke<void>('diagnostics_log', { level, kind, fields: fields ?? {} });
    },
    async residentStatus() {
      const d = await ready();
      return d.invoke<ResidentStatus>('resident_status');
    },
    async markReady() {
      const d = await ready();
      await d.invoke<void>('resident_ready', { generation });
    },
    async quit(options) {
      const d = await ready();
      await d.invoke<void>('resident_quit', { force: options?.force ?? false });
    },
    async ackQuit(request: QuitPrepareRequest, ok, reason) {
      const d = await ready();
      await d.invoke<void>('resident_quit_ack', {
        requestId: request.requestId,
        generation: request.generation,
        ok,
        reason: reason ?? null,
      });
    },
    async showCaptureWindow() {
      const d = await ready();
      await d.invoke<void>('capture_show');
    },
    async captureSubscribed() {
      const d = await ready();
      await d.invoke<void>('resident_capture_subscribed');
    },
    async activationSubscribed() {
      const d = await ready();
      await d.invoke<void>('resident_activation_subscribed');
    },
    async showMain() {
      const d = await ready();
      await d.invoke<void>('resident_show_main');
    },
    async hideMain() {
      const d = await ready();
      await d.invoke<void>('resident_hide_main');
    },
    async wakeScheduler() {
      const d = await ready();
      await d.invoke<void>('scheduler_wake');
    },
    prefs: {
      async get() {
        const d = await ready();
        return d.invoke<DesktopPrefs>('prefs_get');
      },
      async set(patch) {
        const d = await ready();
        return d.invoke<DesktopPrefs>('prefs_set', { patch });
      },
      async migrateLegacy(value) {
        const d = await ready();
        return d.invoke<DesktopPrefs>('prefs_migrate_legacy', { value });
      },
    },
    autostart: {
      async get() {
        const d = await ready();
        return d.invoke<AutostartStatus>('autostart_get');
      },
      async set(enabled) {
        const d = await ready();
        return d.invoke<AutostartStatus>('autostart_set', { enabled });
      },
    },
    async onShellEvent<T>(name: ShellEvent, handler: (payload: T) => void) {
      const d = await ready();
      return d.listen<T>(name, handler);
    },
  };

  return {
    name: 'desktop',
    capabilities: {
      backgroundReminders: true, // the tray keeps the process (and its scheduler) alive when the window closes
      nativeReminders: true, // scheduler.rs delivers due reminders as OS notifications
      dataFolder: true,
      globalHotkey: true,
      tray: true, // resident.rs/tray.rs (week 11); Settings → Desktop shows whether it actually came up
    },
    desktop,

    async createRepository() {
      const d = await ready();
      const opened = await openDesktopRepository(d);
      status = opened.status;
      generation = opened.generation;
      driver = opened.driver;
      // Outcome flags only: no path, no messages.
      recordEvent('info', 'data-file:open', {
        integrityOk: opened.status.integrity.ok,
        fts5: opened.status.integrity.fts5,
        recovered: opened.status.recovery !== null,
        generation: opened.generation,
      });
      return opened.repository;
    },

    async createSearchService(repository) {
      // FTS5 when the bundled SQLite has it (the integrity check already reports it); MiniSearch otherwise.
      return createSearchService({ repo: repository, driver: driver ?? undefined });
    },

    async notify(title, body) {
      const d = await ready();
      let granted = await d.notification.isPermissionGranted();
      if (!granted) granted = (await d.notification.requestPermission()) === 'granted';
      if (!granted) return false;
      d.notification.send(body ? { title, body } : { title });
      return true;
    },

    async exportFile(fileName, contents) {
      const d = await ready();
      const path = await d.saveDialog({ defaultPath: fileName, title: 'Save Orbit export' });
      if (!path) return;
      const text = contents instanceof Blob ? await contents.text() : contents;
      await d.invoke<void>('file_write_text', { path, contents: text });
    },

    async openExternal(url) {
      const d = await ready();
      await d.openUrl(url);
    },

    async requestPersistentStorage(): Promise<StorageStatus> {
      return { persisted: true, usageBytes: null, quotaBytes: null };
    },
  };
}

export const desktopPlatform = createDesktopPlatform();
