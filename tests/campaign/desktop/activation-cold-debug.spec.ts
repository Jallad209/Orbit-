import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser } from '@wdio/globals';
import { SESSION_DIR_FILE } from '../../e2e/tauri/session';

/**
 * Campaign diagnostic for cold activation: what launch mode did the shell
 * detect, was the activation queued and emitted, what did the frontend do?
 * Prints the shell log lines for launch/activate/ready and the pending count.
 */
async function pathname(): Promise<string> {
  const url = new URL(await browser.getUrl());
  return url.pathname + url.search;
}

async function pending(): Promise<unknown> {
  return browser.execute(async () => {
    const internal = (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke(n: string, a?: object): Promise<unknown> };
      }
    ).__TAURI_INTERNALS__;
    try {
      return await internal.invoke('resident_activation_pending', {});
    } catch (e) {
      return `error: ${String(e)}`;
    }
  });
}

function shellLog(): string[] {
  const dir = readFileSync(SESSION_DIR_FILE, 'utf8').trim();
  const logs = join(dir, 'logs');
  try {
    return readdirSync(logs)
      .filter((f) => f.endsWith('.log'))
      .flatMap((f) => readFileSync(join(logs, f), 'utf8').split('\n'))
      .filter((l) => /"op":"(launch|activate|ready|second-instance)"/.test(l));
  } catch (e) {
    return [`no shell log: ${String(e)}`];
  }
}

describe('cold activation diagnostic', () => {
  it('reports what the shell and frontend did with the launch argument', async () => {
    console.log('DBG path@start ' + (await pathname()));
    try {
      const cmd = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          "Get-CimInstance Win32_Process -Filter \"Name='orbit.exe'\" | ForEach-Object { $_.ProcessId.ToString() + ' ' + $_.CommandLine }",
        ],
        { encoding: 'utf8' },
      );
      for (const l of cmd.split(/\r?\n/).filter(Boolean)) console.log('DBG orbit.exe cmdline ' + l);
    } catch (e) {
      console.log('DBG cmdline error ' + String(e));
    }
    const start = await $('button=Start planning');
    await start.waitForDisplayed({ timeout: 30_000 });
    console.log('DBG pending@welcome ' + JSON.stringify(await pending()));
    console.log(
      'DBG firstRunDone@welcome ' +
        (await browser.execute(() => localStorage.getItem('orbit-first-run-done'))),
    );
    await start.click();
    await browser.pause(3000);
    console.log('DBG path@3s-after-click ' + (await pathname()));
    console.log(
      'DBG firstRunDone@after ' +
        (await browser.execute(() => localStorage.getItem('orbit-first-run-done'))),
    );
    console.log('DBG h1@after ' + (await $('h1').getText()));
    console.log('DBG pending@after ' + JSON.stringify(await pending()));
    for (const line of shellLog()) console.log('DBG shell ' + line);
  });
});
