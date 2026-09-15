import { expect, test } from '@playwright/test';

/**
 * The weekly review in a real browser over IndexedDB: start, act on an
 * inbox capture, pause with an unapplied overdue choice, reload and resume
 * at the saved step with the choice restored, walk the remaining steps,
 * finish, and reopen the completed summary. State is verified through
 * what the pages show after reloads, not screenshots.
 */
test('weekly review: pause, reload, resume, and finish with a frozen summary', async ({ page }) => {
  // Seed through the UI: a capture, an overdue task via the inbox, a bill.
  await page.goto('/inbox');
  const capture = page.getByRole('textbox', { name: 'Capture' });
  await capture.fill('t: Late report due 2026-01-05');
  await capture.press('Enter');
  await capture.fill('Buy milk');
  await capture.press('Enter');
  await expect(page.getByTestId('capture-bar')).toBeVisible();
  await page.goto('/bills');
  await page.getByLabel('Title').fill('Rent');
  await page.getByLabel('Amount').fill('900');
  await page.getByLabel('Due date').fill('2026-01-31');
  await page.getByRole('button', { name: 'Add bill' }).click();
  await expect(page.getByTestId('bill-row')).toHaveCount(1);

  await page.goto('/review/weekly');
  await page.getByTestId('start-review').click();
  await expect(page).toHaveURL(/\/review\/weekly\?review=[0-9a-f-]{36}$/);
  const url = page.url();
  const flow = page.getByTestId('weekly-flow');
  await expect(flow).toHaveAttribute('data-step', 'inbox');

  // Inbox: two captures wait; convert both (the task one becomes an overdue task).
  await expect(page.getByTestId('inbox-capture')).toHaveCount(2);
  await expect(page.getByTestId('acknowledge-step')).toBeDisabled();
  for (let i = 0; i < 2; i++) {
    await page
      .getByTestId('inbox-capture')
      .first()
      .getByRole('button', { name: 'Convert' })
      .click();
    await expect(page.getByTestId('inbox-capture')).toHaveCount(1 - i);
  }
  await page.getByTestId('acknowledge-step').click();
  await expect(flow).toHaveAttribute('data-step', 'overdue');

  // Overdue: choose a reschedule, pause without applying.
  const task = page.getByTestId('overdue-task').filter({ hasText: 'Late report' });
  await expect(task).toHaveCount(1);
  await task.getByLabel('Choice for Late report').selectOption('reschedule');
  await page.getByTestId('pause-review').click();
  await expect(page.getByTestId('weekly-landing')).toBeVisible();
  await expect(page.getByTestId('landing-active')).toContainText('at step “Overdue work”');

  // Reload and resume: the choice is back, unapplied.
  await page.reload();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page).toHaveURL(url);
  await expect(flow).toHaveAttribute('data-step', 'overdue');
  await expect(task.getByLabel('Choice for Late report')).toHaveValue('reschedule');
  await page.getByTestId('apply-choices').click();
  await expect(page.getByTestId('acknowledge-step')).toBeEnabled();
  await page.getByTestId('acknowledge-step').click();
  await expect(flow).toHaveAttribute('data-step', 'projects');

  // Projects, goals: nothing to decide; bills: pay the rent; capacity: acknowledge.
  await page.getByTestId('acknowledge-step').click();
  await expect(flow).toHaveAttribute('data-step', 'goals');
  await page.getByTestId('acknowledge-step').click();
  await expect(flow).toHaveAttribute('data-step', 'bills');
  await page.getByTestId('review-bill').getByRole('button', { name: 'Mark paid' }).click();
  await expect(page.getByTestId('acknowledge-step')).toBeEnabled();
  await page.getByTestId('acknowledge-step').click();
  await expect(flow).toHaveAttribute('data-step', 'capacity');
  await expect(page.getByTestId('capacity-day')).toHaveCount(7);
  await page.getByTestId('acknowledge-step').click();
  await expect(page.getByTestId('finish-review')).toBeEnabled();
  await page.getByTestId('finish-review').click();
  await expect(page.getByTestId('completed-review')).toBeVisible();
  await expect(page.getByTestId('receipts').locator('li')).toHaveCount(4);

  // The summary is history: it reads the same after a reload and from the landing.
  await page.reload();
  await expect(page.getByTestId('completed-review')).toContainText('Actions recorded');
  await page.goto('/review/weekly');
  await expect(page.getByText(/completed \d{4}-\d{2}-\d{2}/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review again' })).toBeVisible();
  await expect(page.getByTestId('start-review')).toBeVisible();
});
