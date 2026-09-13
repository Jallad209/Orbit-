import { expect, test, type Page } from '@playwright/test';

/**
 * The capture → structure loop, end to end in a real browser with IndexedDB.
 * Planning, time blocks, and the evening review join this file as those weeks land.
 */

async function createArea(page: Page, name: string) {
  await page.goto('/areas');
  await page.getByRole('textbox', { name: 'Area name' }).fill(name);
  await page.getByRole('button', { name: 'Add area' }).click();
  await expect(page.getByRole('button', { name: `Area name ${name}` })).toBeVisible();
}

test('captures three items, files one into a project, and keeps everything after a reload', async ({
  page,
}) => {
  await createArea(page, 'Study');

  await page.goto('/projects');
  await page.getByRole('textbox', { name: 'Project title' }).fill('Thesis');
  await page.getByRole('button', { name: 'Add project' }).click();
  await expect(page.getByRole('link', { name: /Thesis/ })).toBeVisible();

  await page.goto('/inbox');
  const capture = page.getByRole('textbox', { name: 'Capture' });
  for (const text of [
    'Submit my report next Friday',
    'Pay electricity bill every month',
    'Remind me to ask Omar about his interview',
  ]) {
    await capture.fill(text);
    await expect(page.getByTestId('capture-type')).toBeVisible();
    await capture.press('Enter');
  }
  await expect(page.getByRole('group', { name: 'Tasks' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Bills' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Commitments' })).toBeVisible();

  // Assign the task to the project with the keyboard.
  await page.getByRole('option', { name: /Submit my report/ }).click();
  await page.keyboard.press('p');
  const popover = page.getByRole('dialog', { name: 'Assign project' });
  await popover.getByRole('button', { name: 'Thesis' }).click();
  await expect(page.getByRole('option', { name: /Submit my report/ })).toHaveCount(0);

  // Data is in IndexedDB: a full reload keeps it.
  await page.reload();
  await expect(page.getByRole('group', { name: 'Bills' })).toBeVisible();
  await expect(page.getByRole('option', { name: /Pay electricity bill/ })).toBeVisible();

  await page.goto('/projects');
  const row = page.getByRole('link', { name: /Thesis/ });
  await row.click();
  const taskList = page.getByRole('listbox', { name: 'Project tasks' });
  await expect(taskList.getByRole('option', { name: /Submit my report/ })).toBeVisible();
});

test('quick capture from any screen with c', async ({ page }) => {
  await page.goto('/today');
  // Wait for the shell (and its hotkeys) to be mounted before pressing anything.
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await page.keyboard.press('c');
  const overlay = page.getByTestId('quick-capture');
  await expect(overlay).toBeVisible();
  await overlay.getByRole('textbox', { name: 'Capture' }).fill('Buy milk');
  await overlay.getByRole('textbox', { name: 'Capture' }).press('Enter');
  await expect(overlay).toBeHidden();
  await expect(page.getByText('Captured')).toBeVisible();
  await page.goto('/inbox');
  await expect(page.getByRole('option', { name: /Buy milk/ })).toBeVisible();
});

test('project page: milestones drive progress and the next action clears the flag', async ({
  page,
}) => {
  await createArea(page, 'Health');
  await page.goto('/projects');
  await page.getByRole('textbox', { name: 'Project title' }).fill('Training plan');
  await page.getByRole('button', { name: 'Add project' }).click();
  await page.getByRole('link', { name: /Training plan/ }).click();

  const milestone = page.getByRole('textbox', { name: 'Milestone title' });
  await milestone.fill('Buy shoes');
  await milestone.press('Enter');
  await milestone.fill('Run 5k');
  await milestone.press('Enter');
  await page.getByRole('checkbox', { name: 'Buy shoes done' }).click();
  await expect(page.getByTestId('progress-label')).toContainText('50%');

  await expect(page.getByText('No next action')).toBeVisible();
  const task = page.getByRole('textbox', { name: 'Task title' });
  await task.fill('Week 1 runs');
  await task.press('Enter');
  // The first task added to an empty project becomes the next action automatically.
  await expect(page.getByText('No next action')).toHaveCount(0);
  await expect(page.getByText('Next', { exact: true })).toBeVisible();
});

test('proposes a plan with reasons, accepts it, and keeps the commitment after a reload', async ({
  page,
}) => {
  await createArea(page, 'Study');
  await page.goto('/projects');
  await page.getByRole('textbox', { name: 'Project title' }).fill('Thesis');
  await page.getByRole('button', { name: 'Add project' }).click();
  await page.getByRole('link', { name: /Thesis/ }).click();
  const task = page.getByRole('textbox', { name: 'Task title' });
  for (const title of ['Write intro', 'Literature review', 'Email the supervisor']) {
    await task.fill(title);
    await task.press('Enter');
    await expect(
      page
        .getByRole('listbox', { name: 'Project tasks' })
        .getByRole('option', { name: new RegExp(title) }),
    ).toBeVisible();
  }

  await page.goto('/today');
  const plan = page.getByRole('list', { name: 'Proposed plan' });
  await expect(plan.getByRole('listitem')).toHaveCount(3);
  await expect(page.getByTestId('focus').getByRole('heading', { level: 2 })).toHaveText(
    'Write intro',
  );

  await page.getByRole('button', { name: 'Why Write intro' }).click();
  const why = page.getByTestId('why-popover');
  await expect(why).toContainText('Next action for “Thesis”');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Remove Email the supervisor' }).click();
  await expect(plan.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('list', { name: 'Left out' })).toContainText('Email the supervisor');

  await page.getByRole('button', { name: 'Accept' }).click();
  const panel = page.getByTestId('plan-panel');
  await expect(panel).toHaveAttribute('data-mode', 'committed');
  await expect(
    panel.getByRole('list', { name: 'Committed plan' }).getByRole('listitem'),
  ).toHaveCount(2);

  await page.reload();
  await expect(page.getByTestId('plan-panel')).toHaveAttribute('data-mode', 'committed');
});

test.fixme('drags a block, locks it, and runs the evening review', async () => {
  // Weeks 6–8.
});
