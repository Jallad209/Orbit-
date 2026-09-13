import type { Repository } from '../repository';

/** Give the in-memory test/runtime adapter the same explicit ownership as SQLite. */
export function isolateMemoryRepository(raw: Repository): Repository {
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = tail.then(fn);
    tail = result.catch(() => undefined);
    return result;
  };
  const wrap = (repo: Repository, run: typeof exclusive): Repository => {
    const result: Record<string, unknown> = {
      transaction: <T>(fn: (tx: Repository) => Promise<T>) =>
        run(() =>
          repo.transaction(async (tx) => {
            let active = true;
            const scoped = wrap(tx, async (operation) => {
              if (!active) throw new Error('This transaction has finished.');
              return operation();
            });
            try {
              return await fn(scoped);
            } finally {
              active = false;
            }
          }),
        ),
      close: () => run(() => repo.close()),
    };
    for (const [key, store] of Object.entries(repo)) {
      if (key === 'transaction' || key === 'close') continue;
      const methods: Record<string, unknown> = {};
      for (const name of [
        'get',
        'getMany',
        'list',
        'query',
        'count',
        'upsert',
        'softDelete',
        'forEntity',
        'since',
        'latestSeq',
      ]) {
        const fn = Reflect.get(store as object, name) as
          ((...args: unknown[]) => Promise<unknown>) | undefined;
        if (typeof fn === 'function')
          methods[name] = (...args: unknown[]) => run(() => fn.apply(store, args));
      }
      result[key] = methods;
    }
    return result as unknown as Repository;
  };
  return wrap(raw, exclusive);
}
