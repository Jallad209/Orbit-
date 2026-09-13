import type { SqlDriver, SqlParam } from '@orbit/storage';

/** The shape of `invoke` from `@tauri-apps/api/core`, kept abstract for tests. */
export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * `SqlDriver` over the Rust `db_*` commands. Every call crosses the IPC
 * bridge once; the repository batches its own work into transactions.
 */
export function tauriSqlDriver(invoke: Invoke): SqlDriver {
  return {
    async execute(sql, params: readonly SqlParam[] = []) {
      const rowsAffected = await invoke<number>('db_execute', { sql, params: [...params] });
      return { rowsAffected };
    },
    async select<T>(sql: string, params: readonly SqlParam[] = []) {
      return invoke<T[]>('db_select', { sql, params: [...params] });
    },
    async exec(sql) {
      await invoke<void>('db_exec', { sql });
    },
    async close() {
      await invoke<void>('db_close');
    },
  };
}
