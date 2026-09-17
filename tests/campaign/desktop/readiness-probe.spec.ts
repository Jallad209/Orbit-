import { writeFileSync } from 'node:fs';
import { $, browser } from '@wdio/globals';

/**
 * Campaign diagnostic (not a pass/fail test): from the moment the WebDriver
 * session is usable, how long until (a) the second (capture) window exists,
 * (b) an <h1> is rendered, (c) the first-run "Start planning" button exists.
 * Writes a JSON line so repeated runs can be compared. Never fails on timing.
 */
describe('desktop readiness probe', () => {
  it('records time-to-window and time-to-first-run', async () => {
    const t0 = Date.now();
    let windows2: number | null = null;
    let h1At: number | null = null;
    let h1Text = '';
    let startAt: number | null = null;
    const deadline = t0 + 30_000;
    while (Date.now() < deadline && (windows2 === null || h1At === null || startAt === null)) {
      if (windows2 === null && (await browser.getWindowHandles()).length >= 2)
        windows2 = Date.now() - t0;
      if (h1At === null) {
        const h1 = await $('h1');
        if (await h1.isExisting()) {
          h1At = Date.now() - t0;
          h1Text = await h1.getText();
        }
      }
      if (startAt === null && (await $('button=Start planning').isExisting()))
        startAt = Date.now() - t0;
      await browser.pause(50);
    }
    const row = {
      at: new Date(t0).toISOString(),
      msToSecondWindow: windows2,
      msToH1: h1At,
      h1Text,
      msToStartPlanning: startAt,
      url: await browser.getUrl(),
    };
    console.log('READINESS ' + JSON.stringify(row));
    const out = process.env.ORBIT_PROBE_OUT;
    if (out) writeFileSync(out, JSON.stringify(row) + '\n', { flag: 'a' });
  });
});
