import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import { dismissFirstRun } from './helpers';
import { SESSION_DIR_FILE } from '../session';

/**
 * Quit is real: the process ends in order and the run is marked clean, so
 * the next launch reports no crash. Last in the run because the session
 * cannot outlive the app; the harness tolerates the closed connection.
 */

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await browser.execute(
    async (cmd, params) => {
      const internal = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke<R>(name: string, args: Record<string, unknown>): Promise<R>;
          };
        }
      ).__TAURI_INTERNALS__;
      try {
        return { value: await internal.invoke<T>(cmd, params) };
      } catch (error) {
        return { failure: String(error) };
      }
    },
    command,
    args,
  );
  if ('failure' in result) throw new Error(result.failure);
  return result.value;
}

describe('quit on desktop', () => {
  it('stops in order and leaves a clean last-run marker', async () => {
    await dismissFirstRun();
    await expect($('h1')).toHaveText(/^(Today|Tomorrow)$/);
    await browser.waitUntil(
      async () => (await invoke<{ phase: string }>('resident_status')).phase === 'ready',
      { timeout: 20_000 },
    );
    const dir = readFileSync(SESSION_DIR_FILE, 'utf8').trim();
    const marker = join(dir, 'logs', 'last-run.json');
    expect(existsSync(marker)).toBe(true);
    expect(JSON.parse(readFileSync(marker, 'utf8')).endedCleanly).toBe(false);

    // Fire and forget: the process is gone before the command could answer.
    await browser.execute(() => {
      const internal = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke(name: string, args: Record<string, unknown>): Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      void internal.invoke('resident_quit', {});
    });
    const deadline = Date.now() + 20_000;
    let clean = false;
    while (Date.now() < deadline && !clean) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        clean = JSON.parse(readFileSync(marker, 'utf8')).endedCleanly === true;
      } catch {
        /* being rewritten */
      }
    }
    if (!clean) {
      const { readdirSync } = await import('node:fs');
      for (const f of readdirSync(join(dir, 'logs'))) {
        const tail = readFileSync(join(dir, 'logs', f), 'utf8')
          .split(/\r?\n/)
          .slice(-12);
        console.log('LOG', f, tail.join(' || '));
      }
    }
    expect(clean).toBe(true);
  });
});
