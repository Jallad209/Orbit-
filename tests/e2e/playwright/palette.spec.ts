import { expect, test } from './fixtures';

// The palette's dialog is a lazy chunk. On the first Ctrl+K of a page load an Escape pressed
// before it arrived was swallowed: the palette opened a moment later anyway (docs/A11Y-AUDIT.md).
// Holding the chunk back makes that window as long as the test needs.
const DIALOG_CHUNK = /\/PaletteDialog-[\w-]+\.js$/;

test('Escape pressed while the palette is still loading closes it', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(DIALOG_CHUNK, async (route) => {
    await held;
    await route.continue();
  });

  await page.goto('/today');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Search and commands' });
  await trigger.focus();
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');

  const arrived = page.waitForResponse(DIALOG_CHUNK);
  release();
  await arrived;
  // Nothing to wait on for "stays closed": give the arrived chunk time to render if it would.
  await page.waitForTimeout(500);
  await expect(page.getByTestId('command-palette')).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // And the next Ctrl+K opens it as usual.
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox', { name: 'Command or search' })).toBeFocused();
});
