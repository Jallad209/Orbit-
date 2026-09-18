import { expect, test } from './fixtures';

/**
 * Bills in a real browser over IndexedDB: a monthly series anchored on the
 * 31st, the schedule preview, Mark paid producing exactly one successor on
 * the clamped February date, history staying read-only, a second click
 * replaying instead of duplicating, and Stop repeating on the latest
 * unpaid occurrence.
 */
test('bills: pay a recurring occurrence once, see the successor, and stop the series', async ({
  page,
}) => {
  await page.goto('/bills');
  await page.getByRole('button', { name: 'Add bill' }).click();
  const form = page.getByRole('form', { name: 'New bill' });
  await form.getByLabel('Title').fill('Rent');
  await form.getByLabel('Amount').fill('900');
  await form.getByLabel(/^Currency/).fill('USD');
  await form.getByLabel('Repeats').selectOption('monthly');
  await form.getByLabel('First due date').fill('2026-01-31');
  await expect(form.getByTestId('bill-preview')).toContainText(
    'Monthly on the 31st: first on 2026-01-31, then 2026-02-28 and 2026-03-31',
  );
  await form.getByRole('button', { name: 'Add bill' }).click();

  const row = page.getByTestId('bill-row').filter({ hasText: 'Rent' });
  await expect(row).toHaveCount(1);
  await expect(page.getByTestId('bills-overdue')).toContainText('900.00 USD');
  await row.click();
  await expect(page).toHaveURL(/\/bills\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('bill-position')).toContainText('Occurrence 1');
  await expect(page.getByTestId('pay-card')).toContainText('next occurrence, due 2026-02-28');

  const payButton = page.getByRole('button', { name: 'Mark paid' });
  await payButton.click();
  await expect(page.getByTestId('bill-status')).toContainText('Paid');
  await expect(page.getByText('This payment is history', { exact: false })).toBeVisible();
  const next = page.getByRole('link', { name: 'due 2026-02-28' });
  await expect(next).toBeVisible();
  await expect(page.getByRole('list', { name: 'Occurrences' })).toContainText('#2');

  // One successor, whatever happens to the list after a reload.
  await page.goto('/bills');
  await expect(page.getByTestId('bill-row')).toHaveCount(1);
  await expect(page.getByTestId('bill-row')).toContainText('due 2026-02-28');
  await page.getByRole('button', { name: 'Show' }).first().click();
  await expect(page.getByRole('list', { name: 'Paid bills' }).getByTestId('bill-row')).toHaveCount(
    1,
  );

  // The latest unpaid occurrence can stop the series; paying it then generates nothing.
  await page.getByTestId('bill-row').first().click();
  await expect(page.getByTestId('bill-position')).toContainText('Occurrence 2');
  await page.getByRole('button', { name: 'Stop repeating' }).click();
  await expect(page.getByText('Repeat stopped').first()).toBeVisible();
  await expect(page.getByTestId('pay-card')).toContainText('Repeat is stopped; nothing follows.');
  await page.getByRole('button', { name: 'Mark paid' }).click();
  await expect(page.getByTestId('bill-status')).toContainText('Paid');
  await page.goto('/bills');
  await expect(page.getByTestId('bill-row')).toHaveCount(0);
});
