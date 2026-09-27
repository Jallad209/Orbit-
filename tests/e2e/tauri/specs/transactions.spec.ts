import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { browser, expect } from '@wdio/globals';
import { SESSION_DIR_FILE } from '../session';
import { secondWindowHandle } from './helpers';

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const result = await browser.execute(
    async (cmd, params) => {
      type Bridge = { invoke<R>(name: string, args: Record<string, unknown>): Promise<R> };
      const bridge = () =>
        (window as unknown as { __TAURI_INTERNALS__?: Bridge }).__TAURI_INTERNALS__;
      // Unlike the other specs, this one calls the shell before the app has finished loading
      // (it never runs dismissFirstRun), so the page may not have Tauri's bridge yet — on a
      // slow runner `__TAURI_INTERNALS__` was still undefined. Wait for the bridge itself and
      // nothing more, in whichever window this runs (main first, then capture).
      const ready = Date.now() + 15_000;
      while (!bridge()) {
        if (Date.now() >= ready) return { failure: 'Tauri bridge never appeared in this window' };
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const internal = bridge()!;
      // Like the app driver, wait only for ownership conflicts, never retry SQL errors.
      // Return failures as data so WebDriver does not retry arbitrary writes itself.
      const deadline = Date.now() + 10_000;
      for (;;) {
        try {
          return { value: await internal.invoke<T>(cmd, params) };
        } catch (error) {
          const failure = String(error);
          if (!failure.includes('ORBIT_DB_BUSY:') || Date.now() >= deadline) return { failure };
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
    },
    command,
    args,
  );
  if ('failure' in result) throw new Error(result.failure);
  return result.value;
}

describe('database ownership across desktop windows', () => {
  it('prevents capture writes from joining a main-window transaction and resumes after rollback', async () => {
    const main = await browser.getWindowHandle();
    // The capture window's webview may not have a handle the instant the session opens.
    const capture = await secondWindowHandle();
    expect(capture).toBeDefined();
    const dir = readFileSync(SESSION_DIR_FILE, 'utf8').trim();
    const { generation } = await invoke<{ generation: number; fresh: boolean }>('db_open', {
      path: join(dir, 'data', 'orbit.db'),
    });
    await invoke('db_exec', { sql: 'CREATE TABLE ownership_probe(value TEXT)', generation });
    await expect(invoke('db_exec', { sql: 'BEGIN IMMEDIATE', generation })).rejects.toThrow(
      'owned database transaction',
    );
    const owner = 'desktop-isolation-regression';
    await invoke('db_begin', { owner, generation });
    try {
      await invoke('db_execute', {
        sql: 'INSERT INTO ownership_probe VALUES (?)',
        params: ['rollback'],
        owner,
        generation,
      });
      await browser.switchToWindow(capture);
      const result = await browser.execute(async (epoch) => {
        const internal = (
          window as unknown as {
            __TAURI_INTERNALS__: {
              invoke(name: string, args: Record<string, unknown>): Promise<unknown>;
            };
          }
        ).__TAURI_INTERNALS__;
        try {
          await internal.invoke('db_execute', {
            sql: 'INSERT INTO ownership_probe VALUES (?)',
            params: ['unowned'],
            generation: epoch,
          });
          return 'unexpectedly succeeded';
        } catch (error) {
          return String(error);
        }
      }, generation);
      expect(result).toContain('ORBIT_DB_BUSY:');
    } finally {
      await browser.switchToWindow(main);
      await invoke('db_finish', { owner, generation, commit: false });
    }
    await browser.switchToWindow(capture);
    await invoke('db_execute', {
      sql: 'INSERT INTO ownership_probe VALUES (?)',
      params: ['keep'],
      generation,
    });
    await browser.switchToWindow(main);
    const rows = await invoke<Array<{ value: string }>>('db_select', {
      sql: 'SELECT value FROM ownership_probe',
      params: [],
      generation,
    });
    expect(rows).toEqual([{ value: 'keep' }]);
  });
});
