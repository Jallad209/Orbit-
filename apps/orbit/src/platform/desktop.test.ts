import { describe, expect, it, vi } from 'vitest';
import { createMemoryRepository } from '@orbit/storage';
import { createDesktopPlatform, openDesktopRepository } from './desktop';
import { repositoryKindFor } from './select';
import { tauriSqlDriver } from './tauriSqlDriver';
import { webPlatform } from './web';

describe('platform selection', () => {
  it('picks SQLite when the platform has a data folder, IndexedDB otherwise', () => {
    expect(repositoryKindFor(createDesktopPlatform())).toBe('sqlite');
    expect(repositoryKindFor(webPlatform)).toBe('indexeddb');
    expect(
      repositoryKindFor({ capabilities: { ...webPlatform.capabilities, dataFolder: true } }),
    ).toBe('sqlite');
  });
});

describe('tauriSqlDriver', () => {
  it('maps every driver call onto a db_* command', async () => {
    const invoke = vi.fn(async (cmd: string, _args?: Record<string, unknown>) => {
      if (cmd === 'db_execute') return 3;
      if (cmd === 'db_select') return [{ c: 1 }];
      return undefined;
    });
    const driver = tauriSqlDriver(invoke as never);
    expect(await driver.execute('UPDATE t SET x = ?', ['y'])).toEqual({ rowsAffected: 3 });
    expect(await driver.select('SELECT count(*) AS c FROM t')).toEqual([{ c: 1 }]);
    await driver.exec('BEGIN');
    await driver.close();
    expect(invoke.mock.calls.map((c) => c[0])).toEqual([
      'db_execute',
      'db_select',
      'db_exec',
      'db_close',
    ]);
    expect(invoke.mock.calls[0]![1]).toEqual({ sql: 'UPDATE t SET x = ?', params: ['y'] });
  });
});

/** A fake Rust side: an in-memory "file" whose integrity we can flip. */
function fakeDesktop(
  opts: {
    corrupt?: boolean;
    backups?: Array<{ path: string; modifiedAt: string; sizeBytes: number }>;
  } = {},
) {
  let corrupt = opts.corrupt ?? false;
  let dataDir: string | null = null;
  const calls: string[] = [];
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push(cmd);
    switch (cmd) {
      case 'data_dir_get':
        return dataDir;
      case 'data_dir_default':
        return 'C:\\Users\\me\\AppData\\Roaming\\app.orbit.desktop\\data';
      case 'data_dir_set':
        dataDir = String(args?.path);
        return dataDir;
      case 'db_open':
        return undefined;
      case 'db_select': {
        const sql = String(args?.sql);
        if (corrupt && /integrity_check/.test(sql)) throw new Error('file is not a database');
        if (/integrity_check/.test(sql)) return [{ integrity_check: 'ok' }];
        if (/compile_options/.test(sql)) return [{ compile_options: 'ENABLE_FTS5' }];
        if (/user_version/.test(sql)) return [{ user_version: 1 }];
        if (/journal_mode/.test(sql)) return [{ journal_mode: 'wal' }];
        return [];
      }
      case 'data_quarantine':
        corrupt = false;
        return 'C:\\data\\orbit.corrupt-1.db';
      case 'data_backups':
        return opts.backups ?? [];
      default:
        return undefined;
    }
  });
  return { invoke, calls, join: async (...p: string[]) => p.join('\\') };
}

describe('openDesktopRepository', () => {
  it('uses the default folder on first run, opens the file, and reports integrity', async () => {
    const fake = fakeDesktop();
    const { repository, status } = await openDesktopRepository(fake as never);
    expect(status.dir).toBe('C:\\Users\\me\\AppData\\Roaming\\app.orbit.desktop\\data');
    expect(status.path).toMatch(/orbit\.db$/);
    expect(status.integrity).toEqual({ ok: true, messages: ['ok'], fts5: true });
    expect(status.recovery).toBeNull();
    expect(fake.calls.slice(0, 4)).toEqual([
      'data_dir_get',
      'data_dir_default',
      'data_dir_set',
      'db_open',
    ]);
    expect(repository.tasks).toBeDefined();
  });

  it('quarantines a corrupt file, restores the newest backup, and opens again', async () => {
    const fake = fakeDesktop({
      corrupt: true,
      backups: [
        { path: 'old.db', modifiedAt: '00000000000000000001', sizeBytes: 10 },
        { path: 'new.db', modifiedAt: '00000000000000000009', sizeBytes: 10 },
      ],
    });
    const { status } = await openDesktopRepository(fake as never);
    expect(status.recovery).toEqual({
      quarantinedTo: 'C:\\data\\orbit.corrupt-1.db',
      restoredFrom: 'new.db',
    });
    expect(status.integrity.ok).toBe(true);
    expect(fake.calls.filter((c) => c === 'db_open')).toHaveLength(2);
    expect(fake.calls).toContain('data_restore');
  });

  it('starts fresh when a corrupt file has no backup', async () => {
    const fake = fakeDesktop({ corrupt: true });
    const { status } = await openDesktopRepository(fake as never);
    expect(status.recovery?.restoredFrom).toBeNull();
    expect(fake.calls).not.toContain('data_restore');
  });
});

describe('desktop platform', () => {
  it('exposes desktop capabilities and routes exports through a save dialog', async () => {
    const invoke = vi.fn(async () => undefined);
    const saveDialog = vi.fn(async () => 'D:\\out.json');
    const platform = createDesktopPlatform(async () => ({
      invoke: invoke as never,
      join: async (...p: string[]) => p.join('\\'),
      openDialog: vi.fn(async () => 'D:\\Orbit'),
      saveDialog,
      notification: {
        isPermissionGranted: async () => true,
        requestPermission: async () => 'granted',
        send: vi.fn(),
      },
      window: { startDragging: async () => {} },
      reload: vi.fn(),
    }));
    expect(platform.name).toBe('desktop');
    expect(platform.capabilities).toEqual({
      backgroundReminders: true,
      dataFolder: true,
      globalHotkey: true,
      tray: false,
    });
    await platform.exportFile('orbit-export.json', '{}');
    expect(saveDialog).toHaveBeenCalledWith({
      defaultPath: 'orbit-export.json',
      title: 'Save Orbit export',
    });
    expect(invoke).toHaveBeenCalledWith('file_write_text', {
      path: 'D:\\out.json',
      contents: '{}',
    });
    expect(await platform.notify('Hi')).toBe(true);
    expect(await platform.requestPersistentStorage()).toEqual({
      persisted: true,
      usageBytes: null,
      quotaBytes: null,
    });
    expect(await platform.desktop!.pickDataFolder()).toBe('D:\\Orbit');
    // The web platform keeps working exactly as before.
    expect(createMemoryRepository().tasks).toBeDefined();
  });
});
