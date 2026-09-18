import { browser, expect } from '@wdio/globals';
import { dismissFirstRun, secondWindowHandle } from './helpers';

async function rawInvoke(command: string, args: Record<string, unknown> = {}) {
  return browser.execute(
    async (name, params) => {
      const internal = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke<T>(command: string, args: Record<string, unknown>): Promise<T>;
          };
        }
      ).__TAURI_INTERNALS__;
      try {
        return { ok: true, value: await internal.invoke(name, params) };
      } catch (error) {
        // Not `error`: a `value.error` key in a WebDriver response reads as a protocol error.
        return { ok: false, failure: String(error) };
      }
    },
    command,
    args,
  );
}

describe('per-window command capabilities', () => {
  it('lets main use data commands but rejects capture restore, file-write, and lifecycle commands', async () => {
    await dismissFirstRun();
    const main = await browser.getWindowHandle();
    const dir = await rawInvoke('data_dir_get');
    expect(dir.ok).toBe(true);
    const backups = await rawInvoke('data_backups', { path: dir.value });
    expect(backups.ok).toBe(true);

    const capture = await secondWindowHandle();
    expect(capture).toBeDefined();
    await browser.switchToWindow(capture!);

    for (const [command, args] of [
      ['data_restore_backup', { from: 'blocked.db' }],
      ['file_write_text', { path: 'blocked.txt', content: 'blocked' }],
      ['resident_hide_main', {}],
    ] as const) {
      const result = await rawInvoke(command, args);
      expect(result.ok).toBe(false);
      expect(result.failure).toMatch(/not allowed|permission|denied/i);
    }

    // Capture owns this command; main deliberately does not.
    expect((await rawInvoke('capture_hide')).ok).toBe(true);
    await browser.switchToWindow(main);
    const hiddenFromMain = await rawInvoke('capture_hide');
    expect(hiddenFromMain.ok).toBe(false);
    expect(hiddenFromMain.failure).toMatch(/not allowed|permission|denied/i);
  });
});
