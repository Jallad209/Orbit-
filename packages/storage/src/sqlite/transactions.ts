import type { SqlDriver } from './driver';

type TransactionalDriver = SqlDriver & Required<Pick<SqlDriver, 'transaction'>>;
const drivers = new WeakMap<SqlDriver, TransactionalDriver>();

/** Serialize root calls; only the explicitly passed transaction driver bypasses the queue. */
export function transactionalDriver(raw: SqlDriver): TransactionalDriver {
  const existing = drivers.get(raw);
  if (existing) return existing;
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = tail.then(fn);
    tail = result.catch(() => undefined);
    return result;
  };
  const driver: TransactionalDriver = {
    execute: (sql, params) => exclusive(() => raw.execute(sql, params)),
    select: <T>(sql: string, params?: Parameters<SqlDriver['select']>[1]) =>
      exclusive(() => raw.select<T>(sql, params)),
    exec: (sql) => exclusive(() => raw.exec(sql)),
    close: () => exclusive(() => raw.close()),
    transaction: <T>(fn: (tx: SqlDriver) => Promise<T>) =>
      exclusive(async () => {
        const run = async (connection: SqlDriver): Promise<T> => {
          let active = true;
          const check = () => {
            if (!active)
              throw new Error('This transaction has finished. Use the repository instead.');
          };
          const tx: SqlDriver = {
            execute: async (sql, params) => {
              check();
              return connection.execute(sql, params);
            },
            select: async <R>(sql: string, params?: Parameters<SqlDriver['select']>[1]) => {
              check();
              return connection.select<R>(sql, params);
            },
            exec: async (sql) => {
              check();
              await connection.exec(sql);
            },
            close: async () => {
              throw new Error('Cannot close a transaction-scoped repository.');
            },
          };
          try {
            return await fn(tx);
          } finally {
            active = false;
          }
        };
        if (raw.transaction) return raw.transaction(run);
        await raw.exec('BEGIN IMMEDIATE');
        try {
          const result = await run(raw);
          await raw.exec('COMMIT');
          return result;
        } catch (error) {
          await raw.exec('ROLLBACK');
          throw error;
        }
      }),
  };
  drivers.set(raw, driver);
  drivers.set(driver, driver);
  return driver;
}
