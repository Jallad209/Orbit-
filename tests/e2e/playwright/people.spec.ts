import { expect, test } from './fixtures';

/**
 * People in a real browser over IndexedDB: a person with promises in both
 * directions, the counts on the list, a reply that records contact
 * without completing anything, a separate Mark done, the exact-commitment
 * deep link, and delete/restore keeping the commitments.
 */
test('people: contact is separate from completion, and the list counts both directions', async ({
  page,
}) => {
  await page.goto('/people');
  await page.getByRole('textbox', { name: 'Name' }).fill('Omar');
  await page.getByRole('textbox', { name: 'Contact' }).fill('omar@example.com');
  await page.getByRole('button', { name: 'Add person' }).click();
  const row = page.getByTestId('person-row').filter({ hasText: 'Omar' });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);

  // Two promises owed to me, one I owe.
  const text = page.getByRole('textbox', { name: 'Commitment' });
  await text.fill('Interview feedback');
  await page.getByLabel('Direction', { exact: true }).selectOption('owed-to-me');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(text).toHaveValue('');
  await text.fill('Reference letter');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(text).toHaveValue('');
  await text.fill('Send CV');
  await page.getByLabel('Direction', { exact: true }).selectOption('owed-by-me');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('commitment-row')).toHaveCount(3);
  await expect(page.getByText('Owed to me 2')).toBeVisible();
  await expect(page.getByText('I owe 1')).toBeVisible();

  // A reply records contact and completes nothing.
  await expect(page.getByTestId('last-contact')).toContainText('never');
  await page.getByRole('button', { name: 'Record reply/contact' }).click();
  const dialog = page.getByTestId('contact-dialog');
  await expect(dialog).toContainText('It does not complete any commitment.');
  await dialog.getByRole('button', { name: 'Record contact' }).click();
  await expect(page.getByTestId('last-contact')).not.toContainText('never');
  await expect(page.getByTestId('commitment-row')).toHaveCount(3);

  // Mark done is its own step; the exact commitment deep link highlights the row.
  const feedback = page.getByTestId('commitment-row').filter({ hasText: 'Interview feedback' });
  const id = await feedback.getAttribute('data-commitment-id');
  await feedback.getByRole('button', { name: 'Mark done' }).click();
  await expect(page.getByTestId('commitment-row')).toHaveCount(2);
  await page.getByLabel('Filter by status').selectOption('done');
  await expect(page.getByTestId('commitment-row')).toHaveCount(1);
  const url = page.url();
  await page.goto(`${url}?commitment=${id}`);
  await page.getByLabel('Filter by status').selectOption('done');
  await expect(page.locator(`[data-commitment-id="${id}"]`)).toHaveAttribute(
    'aria-current',
    'true',
  );

  // The list shows the updated counts after a reload.
  await page.goto('/people');
  await expect(page.getByLabel('Owed to you 1')).toBeVisible();
  await expect(page.getByLabel('You owe 1')).toBeVisible();

  // Delete keeps the commitments; restore brings the person back with them.
  await page.getByTestId('person-row').click();
  await page.getByRole('button', { name: 'Delete person' }).click();
  await expect(page.getByRole('dialog')).toContainText('3 commitments will be hidden');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete person' }).click();
  await expect(page.getByText('Omar was deleted')).toBeVisible();
  await page.goto('/people');
  await expect(page.getByTestId('person-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Deleted (1)' }).click();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByTestId('person-row')).toHaveCount(1);
  await page.getByTestId('person-row').click();
  await expect(page.getByTestId('commitment-row')).toHaveCount(2);
});
