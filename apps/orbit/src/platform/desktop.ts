import { chooseRestore, integrityCheck, openRepository } from '@orbit/storage';
import type { BackupCandidate, Repository } from '@orbit/storage';
import { tauriSqlDriver, type Invoke } from './tauriSqlDriver';
import type { DataFileStatus, DesktopApi, Platform, StorageStatus } from './types';

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
  reload(): void;
}

async function loadDeps(): Promise<Deps> {
  const [core, path, dialog, notification, win] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/path'),
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-notification'),
    import('@tauri-apps/api/window'),
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
    reload: () => window.location.reload(),
  };
}

/**
 * Open the data file, run the integrity check, and recover when the file is
 * corrupt: quarantine it, restore the newest backup if there is one, and
 * open again. Pure of Tauri so tests can drive it with a fake `deps`.
 */
export async function openDesktopRepository(
  deps: Pick<Deps, 'invoke' | 'join'>,
): Promise<{ repository: Repository; status: DataFileStatus }> {
  const { invoke, join } = deps;
  let dir = await invoke<string | null>('data_dir_get');
  if (!dir)
    dir = await invoke<string>('data_dir_set', { path: await invoke<string>('data_dir_default') });
  const path = await join(dir, DATA_FILE);

  const open = async () => {
    await invoke<void>('db_open', { path });
    const driver = tauriSqlDriver(invoke);
    return { driver, integrity: await integrityCheck(driver) };
  };

  let { driver, integrity } = await open();
  let recovery: DataFileStatus['recovery'] = null;
  if (!integrity.ok) {
    await driver.close();
    const quarantinedTo = await invoke<string>('data_quarantine', { path });
    const backup = chooseRestore(await invoke<BackupCandidate[]>('data_backups', { path: dir }));
    if (backup) await invoke<void>('data_restore', { from: backup.path, to: path });
    recovery = { quarantinedTo, restoredFrom: backup?.path ?? null };
    ({ driver, integrity } = await open());
  }

  const repository = await openRepository({ kind: 'sqlite', driver });
  return { repository, status: { dir, path, integrity, recovery } };
}

export function createDesktopPlatform(load: () => Promise<Deps> = loadDeps): Platform {
  let deps: Deps | null = null;
  let status: DataFileStatus | null = null;
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
    async hideCaptureWindow() {
      const d = await ready();
      await d.invoke<void>('capture_hide');
    },
    async startDraggingWindow() {
      const d = await ready();
      await d.window.startDragging();
    },
  };

  return {
    name: 'desktop',
    capabilities: {
      backgroundReminders: false, // enabled when the reminder scheduler ships
      dataFolder: true,
      globalHotkey: true,
      tray: false, // week 12
    },
    desktop,

    async createRepository() {
      const d = await ready();
      const opened = await openDesktopRepository(d);
      status = opened.status;
      return opened.repository;
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

    async requestPersistentStorage(): Promise<StorageStatus> {
      return { persisted: true, usageBytes: null, quotaBytes: null };
    },
  };
}

export const desktopPlatform = createDesktopPlatform();
