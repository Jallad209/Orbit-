import Database from 'better-sqlite3';
import type { SqlDriver, SqlParam } from '../src/sqlite/driver';

/**
 * Node driver for tests and scripts: synchronous better-sqlite3 behind the
 * async `SqlDriver` seam the desktop build talks to through Tauri.
 */
export function betterSqliteDriver(file = ':memory:'): SqlDriver & { db: Database.Database } {
  const db = new Database(file);
  return {
    db,
    async execute(sql, params: readonly SqlParam[] = []) {
      const info = db.prepare(sql).run(...params);
      return { rowsAffected: info.changes };
    },
    async select<T>(sql: string, params: readonly SqlParam[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async exec(sql) {
      db.exec(sql);
    },
    async close() {
      db.close();
    },
  };
}
