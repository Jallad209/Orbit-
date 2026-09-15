import { $, browser } from '@wdio/globals';

/**
 * Shared spec helpers for the desktop WebDriver run.
 *
 * A fresh session always starts on the first-run welcome screen. Checking the
 * "Start planning" button with a single `isExisting()` races its render and
 * silently skips the click, leaving the test on the welcome page; every spec
 * must instead wait for the screen and click through it. `dismissFirstRun`
 * does that and tolerates a session that is already past first run.
 */

/**
 * True once the app shell is showing a real screen (not the welcome page). Tolerant of a
 * mid-transition re-render: an `h1` handle can go stale between the existence check and the
 * text read, which is not "ready" — treat it as retry, not an error.
 */
async function onAppShell(): Promise<boolean> {
  try {
    const h1 = await $('h1');
    if (!(await h1.isExisting())) return false;
    const text = await h1.getText();
    return text !== '' && text !== 'Welcome to Orbit';
  } catch {
    return false;
  }
}

/**
 * Complete or skip first-run onboarding, leaving the app settled on its normal shell.
 * Returning the moment the welcome page unmounts would hand the caller an `h1` that is
 * still re-rendering (a stale-element flake in the assertion that usually follows), so
 * wait for the shell heading to be present and stable before returning.
 */
export async function dismissFirstRun(): Promise<void> {
  const start = await $('button=Start planning');
  await browser.waitUntil(async () => (await start.isExisting()) || (await onAppShell()), {
    timeout: 30_000,
    timeoutMsg: 'neither the welcome screen nor the app shell appeared',
  });
  if (await start.isExisting()) await start.click();
  await browser.waitUntil(async () => await onAppShell(), {
    timeout: 30_000,
    timeoutMsg: 'first run did not complete',
  });
  // The route transition off /welcome has to settle before the caller reads the heading,
  // or a cached element from the transition goes stale mid-assertion.
  await expectTodayHeading();
}

/**
 * Wait for the Today (or Tomorrow) heading, re-querying `h1` each poll. A plain
 * `expect($('h1')).toHaveText(...)` caches the element handle and throws
 * "element wasn't found" if the heading re-renders during the assertion (which it does
 * right after a reload); re-querying avoids that stale-element flake.
 */
export async function expectTodayHeading(): Promise<void> {
  await browser.waitUntil(
    async () =>
      /^(Today|Tomorrow)$/.test(
        (await $('h1')
          .getText()
          .catch(() => '')) ?? '',
      ),
    { timeout: 15_000, timeoutMsg: 'the Today heading did not appear' },
  );
}

/**
 * Navigate with a full reload, and make sure the app actually re-boots before returning.
 * Driving a Tauri WebView2 window through WebDriver, a `browser.url()` reload occasionally
 * fails to re-establish the Tauri IPC bridge, leaving the app stuck on its "Opening Orbit…"
 * splash forever (the first `invoke` never resolves). A real reload is unaffected; this is a
 * harness artifact, so retry the reload until the splash clears.
 */
export async function goto(path: string): Promise<void> {
  const origin = new URL(await browser.getUrl()).origin;
  for (let attempt = 0; attempt < 4; attempt++) {
    await browser.url(`${origin}${path}`);
    const booted = await browser
      .waitUntil(
        async () => {
          const body = await $('body')
            .getText()
            .catch(() => '');
          return body !== '' && !body.includes('Opening Orbit');
        },
        { timeout: 8_000 },
      )
      .then(
        () => true,
        () => false,
      );
    if (booted) return;
  }
  throw new Error(`the app stayed on the opening splash after navigating to ${path}`);
}

/** The non-main window handle (the quick-capture window), once it exists. */
export async function secondWindowHandle(): Promise<string> {
  const main = await browser.getWindowHandle();
  let other: string | undefined;
  await browser.waitUntil(
    async () => {
      other = (await browser.getWindowHandles()).find((h) => h !== main);
      return other !== undefined;
    },
    { timeout: 20_000, timeoutMsg: 'the capture window handle never appeared' },
  );
  return other!;
}
