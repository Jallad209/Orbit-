import type { SqlDriver, SqlParam } from '@orbit/storage';

/** The shape of `invoke` from `@tauri-apps/api/core`, kept abstract for tests. */
export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * `SqlDriver` over the Rust `db_*` commands. Every call crosses the IPC
 * bridge once; the repository batches its own work into transactions.
 */
export function tauriSqlDriver(invoke: Invoke, generation = 0): SqlDriver {
  const call: Invoke = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    const deadline = Date.now() + 35_000;
    for (;;) {
      try {
        return await invoke<T>(cmd, { ...args, generation });
      } catch (error) {
        if (!String(error).includes('ORBIT_DB_BUSY:') || Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  };
  const connection = (owner?: string): SqlDriver => ({
    async execute(sql, params: readonly SqlParam[] = []) {
      const rowsAffected = await call<number>('db_execute', {
        sql,
        params: [...params],
        ...(owner ? { owner } : {}),
      });
      return { rowsAffected };
    },
    async select<T>(sql: string, params: readonly SqlParam[] = []) {
      return call<T[]>('db_select', { sql, params: [...params], ...(owner ? { owner } : {}) });
    },
    async exec(sql) {
      await call<void>('db_exec', { sql, ...(owner ? { owner } : {}) });
    },
    async close() {
      await call<void>('db_close');
    },
  });
  return {
    ...connection(),
    async transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
      const owner = crypto.randomUUID();
      await call<void>('db_begin', { owner });
      try {
        const result = await fn(connection(owner));
        await call<void>('db_finish', { owner, commit: true });
        return result;
      } catch (error) {
        await call<void>('db_finish', { owner, commit: false }).catch(() => undefined);
        throw error;
      }
    },
  };
}
