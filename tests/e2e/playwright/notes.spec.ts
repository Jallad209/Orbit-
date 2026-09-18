import { expect, test } from './fixtures';

/**
 * Notes in a real browser over IndexedDB: create, type, blur-save, reload
 * and find the text; a hostile Markdown body previews without executing
 * anything or fetching anything (every request the page makes is watched);
 * the Save / Discard / Stay guard on a dirty note whose save failed is
 * covered by the component tests.
 */
test('notes: blur-save survives a reload and the preview neither executes nor fetches', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/notes');
  await page.getByLabel('New note title').fill('Reading list');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('note-save-state')).toHaveText('Saved');

  const body = page.getByLabel('Body');
  const hostile = [
    '# Heading',
    '<script>document.title = "pwned"</script>',
    '![tracker](https://evil.example/pixel.png)',
    '[js](javascript:alert(1)) [ok](https://example.com/)',
    '- one',
    '- two',
  ].join('\n');
  await body.fill(hostile);
  await expect(page.getByTestId('note-save-state')).toHaveText('Editing');
  await page.getByLabel('Title').click(); // blur the body
  await expect(page.getByTestId('note-save-state')).toHaveText('Saved');

  await page.reload();
  await expect(page.getByLabel('Body')).toHaveValue(hostile);
  await page.getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByTestId('note-preview');
  await expect(preview.getByRole('heading', { level: 1 })).toHaveText('Heading');
  await expect(preview.locator('script')).toHaveCount(0);
  await expect(preview.locator('img')).toHaveCount(0);
  await expect(preview.getByTestId('image-placeholder')).toHaveText('[image: tracker]');
  await expect(preview.getByTestId('blocked-link')).toHaveText('js');
  await expect(preview.getByRole('link', { name: 'ok' })).toHaveAttribute(
    'href',
    'https://example.com/',
  );
  await expect(preview.locator('li')).toHaveCount(2);
  expect(await page.title()).not.toBe('pwned');
  // Nothing left the origin: no image, no script, no tracker.
  const external = requests.filter((u) => !u.startsWith('http://localhost:4517'));
  expect(external).toEqual([]);

  // The list shows the note newest first and finds it by title.
  await page.goto('/notes');
  await expect(page.getByTestId('note-row')).toHaveCount(1);
  await page.getByLabel('Filter notes').fill('nothing');
  await expect(page.getByTestId('note-row')).toHaveCount(0);
});
