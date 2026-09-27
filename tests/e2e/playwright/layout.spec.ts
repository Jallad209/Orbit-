import { expect, test, type Page } from './fixtures';

// jsdom has no layout, so the shell's scrolling can only be checked in a real browser.
// The regression: the navigation rail scrolled out of view with a long page. The document
// stays the scroller (so the browser's keyboard scrolling keeps working) and the rail is sticky.

const documentScrollTop = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollTop);

async function openSettings(page: Page) {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  return page.getByRole('navigation', { name: 'Primary' });
}

test('the navigation rail stays in view while a long page scrolls', async ({ page }) => {
  const rail = await openSettings(page);

  const main = await page.getByRole('main').boundingBox();
  await page.mouse.move(main!.x + main!.width / 2, main!.y + 200);
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => documentScrollTop(page)).toBeGreaterThan(0);

  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).not.toBeInViewport();
  await expect(rail.getByRole('link', { name: /^Today/ })).toBeInViewport();
  await expect(rail.getByRole('link', { name: /^Settings/ })).toBeInViewport();

  // The document outlives the route, so the next page must not open part-way down.
  await rail.getByRole('link', { name: /^Spending/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Spending & bills' })).toBeVisible();
  expect(await documentScrollTop(page)).toBe(0);
});

test('Page Down scrolls the page after a rail link is clicked', async ({ page }) => {
  const rail = await openSettings(page);
  // Chromium and Firefox focus the clicked link, so the key starts in the rail (WebKit
  // leaves focus on the body). An inner scrolling pane for the page would leave it inert.
  await rail.getByRole('link', { name: /^Settings/ }).click();

  await page.keyboard.press('PageDown');
  await expect.poll(() => documentScrollTop(page)).toBeGreaterThan(0);
});

test('at 400% zoom the rail keeps to the window and scrolls on its own', async ({ page }) => {
  // 400% of a 1280 × 820 window: the rail is taller than the window here.
  await page.setViewportSize({ width: 320, height: 205 });
  const rail = await openSettings(page);
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(() => documentScrollTop(page)).toBeGreaterThan(0);

  const box = await rail.boundingBox();
  expect(box!.y).toBe(0);
  expect(box!.height).toBe(205);
  expect(await rail.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
});
