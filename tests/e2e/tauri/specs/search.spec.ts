import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import { betterSqliteDriver } from '@orbit/storage/test/betterSqliteDriver';
import { SESSION_DIR_FILE } from '../session';

/**
 * Search and diagnostics on the real desktop app. A note captured in the
 * quick-capture window and accepted in the main window is found through
 * Ctrl+K without a reload: the FTS5 triggers index it inside the write.
 * Then the diagnostics commands: the last-run marker says the previous
 * session was clean, and an export writes a zip whose report holds counts
 * and versions but not the note's title.
 */

async function goto(path: string) {
  const origin = new URL(await browser.getUrl()).origin;
  await browser.url(`${origin}${path}`);
}

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

const NOTE = 'Lighthouse keeper memo';

describe('search and diagnostics on desktop', () => {
  it('finds a note captured in the quick-capture window, through the FTS5 index', async () => {
    const start = await $('button=Start planning');
    if (await start.isExisting()) await start.click();
    await expect($('h1')).toHaveText(/^(Today|Tomorrow)$/);

    // Capture in the other webview (the system-wide capture window).
    const main = await browser.getWindowHandle();
    const capture = (await browser.getWindowHandles()).find((h) => h !== main)!;
    await browser.switchToWindow(capture);
    const bar = await $('[aria-label="Capture"]');
    await bar.setValue(`note: ${NOTE}`);
    await expect($('[data-testid="capture-type"]')).toHaveText('Note');
    await browser.keys('Enter');
    await browser.switchToWindow(main);

    // Accept it in the main window's inbox, then search from anywhere.
    await goto('/inbox');
    await $(`[role="option"]*=${NOTE}`).click();
    await browser.keys('Enter');
    await expect($(`[role="option"]*=${NOTE}`)).not.toBeExisting();

    await goto('/today');
    await expect($('h1')).toHaveText(/^(Today|Tomorrow)$/);
    await browser.keys(['Control', 'k']);
    const box = await $('[role="combobox"][aria-label="Command or search"]');
    await expect(box).toBeFocused();
    await box.setValue('lighthouse');
    const results = await $('[role="group"][aria-label="Results"]');
    await expect(results.$(`[role="option"]*=${NOTE}`)).toBeDisplayed();
    await browser.keys('Escape');

    // The index is the file's own: FTS5, kept by triggers, no rebuild needed.
    const dir = readFileSync(SESSION_DIR_FILE, 'utf8').trim();
    const driver = betterSqliteDriver(join(dir, 'data', 'orbit.db'));
    try {
      const rows = await driver.select<{ title: string }>(
        "SELECT title FROM search_fts WHERE type = 'note'",
      );
      expect(rows.map((r) => r.title)).toContain(NOTE);
      const marker = await driver.select<{ value: string }>(
        "SELECT value FROM search_meta WHERE key = 'schema'",
      );
      expect(marker).toHaveLength(1);
    } finally {
      await driver.close();
    }
  });

  it('reports a clean previous run and writes a diagnostics zip without record text', async () => {
    const lastRun = await invoke<{ crashedLastTime: boolean }>('diagnostics_last_run');
    expect(lastRun.crashedLastTime).toBe(false);

    const dir = readFileSync(SESSION_DIR_FILE, 'utf8').trim();
    const path = join(dir, 'diagnostics.zip');
    const bundle = await invoke<{ path: string; files: string[]; bytes: number }>(
      'diagnostics_export',
      { path, report: { generatedAt: '2026-09-14T00:00:00.000Z', data: { notes: { live: 1 } } } },
    );
    expect(existsSync(bundle.path)).toBe(true);
    expect(bundle.bytes).toBeGreaterThan(0);
    expect(bundle.files[0]).toBe('report.json');
    expect(bundle.files).toContain('last-run.json');
    expect(bundle.files.some((f) => f.startsWith('logs/orbit-'))).toBe(true);
    // Deflated entries are opaque, but the zip's central directory keeps names in the clear:
    // the note's title must appear nowhere in the file.
    const raw = readFileSync(bundle.path, 'latin1');
    expect(raw).toContain('report.json');
    expect(raw).not.toContain(NOTE);
  });
});
