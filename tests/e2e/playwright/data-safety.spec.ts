import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Data safety in the browser runtime (DEVOPS-TASKS week 5).
 * Everything here runs against the production build with a real IndexedDB.
 */

async function createAreas(page: Page, names: string[]) {
  await page.goto('/areas');
  for (const name of names) {
    await page.getByRole('textbox', { name: 'Area name' }).fill(name);
    await page.getByRole('button', { name: 'Add area' }).click();
    await expect(page.getByRole('button', { name: `Area name ${name}` })).toBeVisible();
  }
}

async function capture(page: Page, texts: string[]) {
  await page.goto('/inbox');
  const box = page.getByRole('textbox', { name: 'Capture' });
  for (const text of texts) {
    await box.fill(text);
    await expect(page.getByTestId('capture-type')).toBeVisible();
    await box.press('Enter');
    await expect(page.getByRole('option', { name: new RegExp(text) })).toBeVisible();
  }
}

test('every record is still there after a reload and after closing the tab', async ({
  page,
  context,
}) => {
  const areas = ['Health', 'Study', 'Work', 'Home', 'Money'];
  const captures = ['Buy milk', 'Call the dentist', 'Water the plants', 'Pay rent'];
  await createAreas(page, areas);
  await capture(page, captures);

  await page.reload();
  await expect(page.getByRole('option')).toHaveCount(captures.length);

  // A brand-new tab in the same browser profile sees the same database.
  const fresh = await context.newPage();
  await fresh.goto('/areas');
  for (const name of areas) {
    await expect(fresh.getByRole('button', { name: `Area name ${name}` })).toBeVisible();
  }
  await fresh.goto('/inbox');
  await expect(fresh.getByRole('option')).toHaveCount(captures.length);
});

test('a browser that refuses persistent storage shows the warning and a working export', async ({
  page,
}) => {
  // Simulate `navigator.storage.persist()` being denied (private mode, no install).
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persist: async () => false,
        persisted: async () => false,
        estimate: async () => ({ usage: 4096, quota: 1_000_000 }),
      },
    });
  });
  await createAreas(page, ['Health']);

  const banner = page.getByTestId('storage-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('has not promised to keep');

  const download = page.waitForEvent('download');
  await banner.getByRole('button', { name: 'Export now' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^orbit-export-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await file.path();
  const envelope = JSON.parse(readFileSync(path!, 'utf8')) as {
    format: string;
    data: { areas: Array<{ name: string }> };
  };
  expect(envelope.format).toBe('orbit-export');
  expect(envelope.data.areas.map((a) => a.name)).toEqual(['Health']);
  await expect(page.getByText('Export saved')).toBeVisible();
});
