import { expect, test, type Page } from './fixtures';

/**
 * Insights in a real browser over IndexedDB: an area target above next
 * week's capacity produces the weekly deficit observation on /insights and
 * on Today; its evidence names every counted day; a snooze survives a
 * reload and is listed in history; Restore brings it back; the Timeline
 * evidence link opens the named day; the Settings threshold form validates.
 */

async function seedTarget(page: Page) {
  await page.goto('/areas');
  await page.getByRole('textbox', { name: 'Area name' }).fill('University');
  await page.getByRole('button', { name: 'Add area' }).click();
  await expect(page.getByRole('button', { name: 'Area name University' })).toBeVisible();
  // 100 h a week can never fit a 09:00–18:00 window with a lunch break (57.75 h).
  const target = page.getByRole('spinbutton', { name: 'Weekly hours target for University' });
  await target.fill('100');
  await target.blur();
  await expect(page.getByText(/of 200.0h/)).toBeVisible();
}

test('weekly deficit shows on Today and Insights, snoozes across a reload, and restores', async ({
  page,
}) => {
  await seedTarget(page);

  await page.goto('/today');
  const strip = page.getByTestId('insights');
  await expect(strip.getByTestId('insight-card')).toHaveCount(1);
  await expect(strip).toContainText('Weekly area targets exceed available time.');
  await expect(strip.getByRole('button', { name: /Snooze/ })).toHaveCount(0);
  await page.getByTestId('insights-see-all').click();
  await expect(page).toHaveURL(/\/insights$/);

  const card = page.getByTestId('insight-card');
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute('data-severity', 'risk');
  await expect(card.getByTestId('insight-threshold')).toContainText('min > 0 min');
  await card.getByRole('button', { name: /Evidence \(8\)/ }).click();
  const evidence = card.getByRole('list', { name: 'Evidence, 8 rows' });
  await expect(evidence).toContainText('University: 100 h a week = 6000 min');
  await expect(evidence.getByRole('link', { name: 'Open that day' })).toHaveCount(7);
  await expect(card).toContainText('weekends count unless a reservation or event blocks them');

  // The first counted day opens on the Timeline at that date.
  const firstDay = evidence.getByRole('link', { name: 'Open that day' }).first();
  const href = await firstDay.getAttribute('href');
  expect(href).toMatch(/^\/timeline\?date=\d{4}-\d{2}-\d{2}$/);
  await firstDay.click();
  await expect(page).toHaveURL(new RegExp(href!.replace('?', '\\?')));
  await expect(page.getByRole('button', { name: href!.slice(-10) })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Snooze for a week; the observation is gone from Today and Insights even after a reload.
  await page.goto('/insights');
  await page.getByRole('button', { name: /^Snooze:/ }).click();
  await page.getByRole('menuitem', { name: '1 week' }).click();
  await expect(page.getByTestId('insight-card')).toHaveCount(0);
  await expect(page.getByText('1 observation is snoozed or dismissed')).toBeVisible();
  await page.reload();
  await expect(page.getByText('1 observation is snoozed or dismissed')).toBeVisible();
  const history = page.getByTestId('insight-history');
  await expect(history).toContainText('Weekly area targets exceed available time.');
  await expect(history).toContainText(/Snoozed until/);
  await page.goto('/today');
  await expect(page.getByTestId('insights')).toHaveCount(0);

  // Restore brings it straight back.
  await page.goto('/insights');
  await page.getByRole('button', { name: /^Restore:/ }).click();
  await expect(page.getByTestId('insight-card')).toHaveCount(1);
  await expect(page.getByText('No history')).toBeVisible();
});

test('the Insights settings validate thresholds and the command palette opens the page', async ({
  page,
}) => {
  await page.goto('/settings');
  const form = page.getByRole('form', { name: 'Insight settings' });
  const stale = form.getByLabel(/Stale project after/);
  await stale.fill('0');
  await form.getByRole('button', { name: 'Save insight settings' }).click();
  await expect(form.getByRole('alert')).toContainText('Use a whole number between 1 and 90.');
  await stale.fill('14');
  await form.getByRole('button', { name: 'Save insight settings' }).click();
  await expect(page.getByText('Insight settings saved')).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('form', { name: 'Insight settings' }).getByLabel(/Stale project after/),
  ).toHaveValue('14');

  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Command or search' }).fill('open insights');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/insights$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();
  await expect(page.getByTestId('insights-coverage')).toContainText(
    'Stale projects: there are no active projects.',
  );
});
