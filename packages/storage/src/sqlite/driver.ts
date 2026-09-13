/**
 * The thin seam between the SQLite repository and whatever executes SQL:
 * `better-sqlite3` in Node tests, a Tauri command backed by rusqlite on
 * desktop. One connection, statements run in order, no pooling.
 */
export type SqlParam = string | number | null;

export interface SqlDriver {
  /** Run one statement that returns no rows. */
  execute(sql: string, params?: readonly SqlParam[]): Promise<{ rowsAffected: number }>;
  /** Run one statement and return its rows as plain objects. */
  select<T = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): Promise<T[]>;
  /** Run a script of several statements (migrations). No parameters. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}
