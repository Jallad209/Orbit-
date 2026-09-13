import { expect, test, type Page } from '@playwright/test';

/**
 * The command centre in a real browser: Ctrl+K opens the palette over the
 * IndexedDB-backed index, a command with a prompt writes and can be undone,
 * the search page filters through the URL, and results open a project or a
 * read-only preview.
 */

async function seed(page: Page) {
  await page.goto('/areas');
  await page.getByRole('textbox', { name: 'Area name' }).fill('University');
  await page.getByRole('button', { name: 'Add area' }).click();
  await expect(page.getByRole('button', { name: 'Area name University' })).toBeVisible();

  await page.goto('/projects');
  await page.getByRole('textbox', { name: 'Project title' }).fill('Thesis');
  await page.getByRole('button', { name: 'Add project' }).click();
  await expect(page.getByRole('link', { name: /Thesis/ })).toBeVisible();

  await page.goto('/inbox');
  const capture = page.getByRole('textbox', { name: 'Capture' });
  for (const text of [
    'note: University reading list',
    'task: Fill in the university fees form next Friday',
    'Remind me to ask @Omar about the lab',
  ]) {
    await capture.fill(text);
    await expect(page.getByTestId('capture-type')).toBeVisible();
    await capture.press('Enter');
  }
  // Accept all three so they exist as records the index sees (the commitment creates Omar).
  for (const name of [
    /University reading list/,
    /Fill in the university fees form/,
    /Ask Omar about the lab/,
  ]) {
    await page.getByRole('option', { name }).click();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('option', { name })).toHaveCount(0);
  }
}

test('Ctrl+K finds records and runs a command with a prompt, then undoes it', async ({ page }) => {
  await seed(page);
  await page.goto('/today');
  await expect(page.getByRole('heading', { level: 1, name: /^(Today|Tomorrow)$/ })).toBeVisible();

  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox', { name: 'Command or search' });
  await expect(box).toBeFocused();
  await box.fill('find notes about university');
  const results = page.getByRole('group', { name: 'Results' });
  await expect(results.getByRole('option').first()).toBeVisible();
  await expect(
    results.getByRole('option').filter({ hasText: 'University reading list' }),
  ).toHaveCount(1);
  await expect(results.locator('mark').first()).toBeVisible();

  // type:note narrows to the note; Enter opens it in the search preview.
  await box.fill('type:note univ');
  await expect(results.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/search\?q=type%3Anote\+univ&open=note%3A/);
  const preview = page.getByTestId('search-preview');
  await expect(preview).toContainText('University reading list');
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);

  // A command with a prompt: validation in place, then a write with Undo.
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Command or search' }).fill('add task');
  await expect(page.getByRole('option', { name: /Add task/ }).first()).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Enter');
  const field = page.getByLabel('What needs doing?');
  await expect(field).toBeFocused();
  await field.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Type something first.');
  await field.fill('Water the plants');
  await field.press('Enter');
  await expect(page.getByTestId('command-palette')).toHaveCount(0);
  const toast = page.getByText('Added task');
  await expect(toast).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Undid: Add task')).toBeVisible();

  await page.goto('/search?q=plants');
  await expect(page.getByTestId('search-empty')).toBeVisible();
});

test('the search page filters through the URL and opens a project or a preview', async ({
  page,
}) => {
  await seed(page);
  await page.goto('/search?q=univ');
  const input = page.getByRole('searchbox', { name: 'Search' });
  await expect(input).toHaveValue('univ');
  const hits = page.getByTestId('search-hit');
  await expect(hits).toHaveCount(3); // the note, the task, and the project (its area is University)

  await page.getByRole('checkbox', { name: 'Tasks' }).click();
  await expect(input).toHaveValue('type:task univ');
  await expect(hits).toHaveCount(1);
  await expect(hits.first()).toHaveAttribute('data-type', 'task');
  await expect(page).toHaveURL(/q=type%3Atask\+univ/);

  await page.goBack();
  await expect(input).toHaveValue('univ');
  await expect(hits).toHaveCount(3);

  await page.getByRole('button', { name: 'Open: Thesis' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Thesis' })).toBeVisible();

  await page.goto('/search?q=omar');
  await page.getByRole('button', { name: 'Preview: Omar' }).click();
  const preview = page.getByTestId('search-preview');
  await expect(preview).toContainText('Omar');
  await expect(preview).toContainText('Open commitments');
});
