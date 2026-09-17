import { $, browser, expect } from '@wdio/globals';

/**
 * The shipped activation-cold spec with one change: it waits for the first-run
 * button instead of checking existence once. Used to separate the launch-arg
 * split defect from the readiness race.
 */
async function pathname(): Promise<string> {
  const url = new URL(await browser.getUrl());
  return url.pathname + url.search;
}

describe('cold activation on desktop (waiting variant)', () => {
  it('opens the activation on the safe page once first run is finished', async () => {
    const expected = (process.env.ORBIT_CAMPAIGN_ARGS ?? '').split('/').pop()!;
    const start = await $('button=Start planning');
    await start.waitForDisplayed({ timeout: 30_000 });
    await start.click();
    await browser.waitUntil(async () => (await pathname()).startsWith('/missing?type=task'), {
      timeout: 30_000,
      timeoutMsg: `never reached the missing page; at ${await pathname()}`,
    });
    expect(await pathname()).toBe(`/missing?type=task&id=${expected}`);
    await expect($('p*=no longer exists')).toBeExisting();
  });
});
