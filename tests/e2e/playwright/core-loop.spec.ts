import { expect, test, type Page } from './fixtures';

/**
 * The capture → structure loop, end to end in a real browser with IndexedDB.
 * Planning, time blocks, and the evening review join this file as those weeks land.
 */

// Pin the clock to a weekday morning so the planner always sees an open working window
// (09:00–18:00 local). Without this the plan-size assertions depend on the time of day the
// suite happens to run and fail every afternoon. setFixedTime fixes what `new Date()`
// returns without faking timers, so autosave/debounce still work. 06:00Z == 09:00 in
// Asia/Amman, the timezone pinned in playwright.config.ts.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-14T06:00:00.000Z'));
});

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
  await expect(page.getByText('Added to Thesis', { exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: /Submit my report/ })).toHaveCount(0);

  // Data is in IndexedDB: a full reload keeps it.
  await page.reload();
  await expect(page.getByRole('group', { name: 'Bills' })).toBeVisible();
  await expect(page.getByRole('option', { name: /Pay electricity bill/ })).toBeVisible();

  await page.goto('/projects');
  const row = page.getByRole('link', { name: /Thesis/ });
  await row.click();
  const taskList = page.getByRole('list', { name: 'Project tasks' });
  await expect(
    taskList.getByRole('listitem').filter({ hasText: 'Submit my report' }),
  ).toBeVisible();
});

test('quick capture from any screen with c', async ({ page }) => {
  await page.goto('/today');
  // Wait for the shell (and its hotkeys) to be mounted before pressing anything.
  await expect(page.getByRole('heading', { level: 1, name: /^(Today|Tomorrow)$/ })).toBeVisible();
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
  for (const title of ['Buy shoes', 'Run 5k']) {
    await milestone.fill(title);
    await milestone.press('Enter');
    await expect(page.getByRole('checkbox', { name: `${title} done` })).toBeVisible();
  }
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
        .getByRole('list', { name: 'Project tasks' })
        .getByRole('listitem')
        .filter({ hasText: title }),
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

test('timeline: schedules a task, locks it, moves another around it, and re-plans', async ({
  page,
}) => {
  await createArea(page, 'Study');
  await page.goto('/projects');
  await page.getByRole('textbox', { name: 'Project title' }).fill('Thesis');
  await page.getByRole('button', { name: 'Add project' }).click();
  await page.getByRole('link', { name: /Thesis/ }).click();
  const task = page.getByRole('textbox', { name: 'Task title' });
  for (const title of ['Write intro', 'Literature review']) {
    await task.fill(title);
    await task.press('Enter');
    await expect(
      page
        .getByRole('list', { name: 'Project tasks' })
        .getByRole('listitem')
        .filter({ hasText: title }),
    ).toBeVisible();
  }

  await page.goto('/timeline');
  await expect(page.getByRole('heading', { level: 1, name: 'Timeline' })).toBeVisible();
  // Use a full working day even when this test runs after today's working window.
  await page.getByRole('button', { name: 'Next day' }).click();
  await page.getByRole('button', { name: 'Schedule Write intro' }).click();
  const intro = page.getByRole('button', { name: /^Write intro \d/ });
  await expect(intro).toBeVisible();
  const introStart = Number(await intro.getAttribute('data-start'));

  // Lock it with the keyboard, then it refuses to move.
  await intro.click();
  await page.keyboard.press('l');
  await expect(intro).toHaveAttribute('data-locked', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByText('Unlock the block to move it.')).toBeVisible();
  expect(Number(await intro.getAttribute('data-start'))).toBe(introStart);

  // Schedule the other task and nudge it later; the locked block stays put.
  await page.getByRole('button', { name: 'Schedule Literature review' }).click();
  const lit = page.getByRole('button', { name: /^Literature review \d/ });
  await expect(lit).toBeVisible();
  const litStart = Number(await lit.getAttribute('data-start'));
  await lit.click();
  await page.keyboard.press('ArrowDown');
  await expect(lit).toHaveAttribute('data-start', String(litStart + 15));
  expect(Number(await intro.getAttribute('data-start'))).toBe(introStart);
  await expect(page.getByText('Day re-planned').first()).toBeVisible();
});

test('morning briefing → timer → completion prompt → evening shutdown with a rollover', async ({
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
        .getByRole('list', { name: 'Project tasks' })
        .getByRole('listitem')
        .filter({ hasText: title }),
    ).toBeVisible();
  }

  // Morning: answer the three configurable check-in questions, then choose energy by hotkey.
  await page.goto('/today');
  const launcher = page.getByRole('link', { name: 'Start morning briefing' });
  const date = new URL(
    await launcher.getAttribute('href').then((h) => h!),
    'http://x',
  ).searchParams.get('date')!;
  await launcher.click();
  const flow = page.getByTestId('morning-flow');
  await expect(flow).toHaveAttribute('data-step', '0');
  for (let step = 0; step < 3; step++) {
    await page.getByRole('button', { name: 'No, continue' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
  }
  await expect(flow).toHaveAttribute('data-step', '3');
  await page.keyboard.press('3');
  await expect(page.getByRole('radio', { name: /high/ })).toBeChecked();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('morning-at-risk')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('morning-plan')).toHaveAttribute('data-energy', 'high');
  await expect(page.getByRole('list', { name: 'Proposed plan' }).getByRole('listitem')).toHaveCount(
    3,
  );
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Accept plan' }).click();
  await expect(page.getByTestId('plan-panel')).toHaveAttribute('data-mode', 'committed');
  await expect(page.getByRole('link', { name: 'Start morning briefing' })).toHaveCount(0);

  // Timer on the focus task; a reload keeps it running.
  const focus = page.getByTestId('focus');
  await expect(focus.getByRole('heading', { level: 2 })).toHaveText('Write intro');
  await focus.getByRole('button', { name: 'Start' }).click();
  await expect(focus.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(focus.getByTestId('timer-elapsed')).toBeVisible();
  await expect(page).toHaveTitle(/^\d+:\d\d · Write intro$/);
  await page.reload();
  await expect(focus.getByRole('button', { name: 'Stop' })).toBeVisible();
  await focus.getByRole('button', { name: 'Stop' }).click();
  await expect(focus.getByRole('button', { name: 'Start' })).toBeVisible();
  await expect(page).toHaveTitle('Orbit');
  // Done on a task with a session: no prompt, the actual comes from the timer.
  await focus.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Write intro' })).toBeVisible();
  await expect(page.getByTestId('complete-dialog')).toHaveCount(0);

  // Complete a second task without a timer: the prompt asks for the actual.
  await page.goto('/projects');
  await page.getByRole('link', { name: /Thesis/ }).click();
  await page.getByRole('checkbox', { name: 'Complete Literature review' }).click();
  const dialog = page.getByTestId('complete-dialog');
  await expect(dialog).toBeVisible();
  const actual = dialog.getByRole('textbox', { name: 'Actual time' });
  await expect(actual).toHaveValue('30m');
  await actual.fill('45');
  await actual.press('Enter');
  await expect(dialog).toHaveCount(0);

  // Evening: two done, one unfinished, rolled over to next week.
  await page.goto(`/review/evening?date=${date}`);
  await expect(page.getByTestId('evening-committed')).toContainText('2 of 3 committed tasks done');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('evening-no-actuals')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  const rows = page.getByRole('list', { name: 'Unfinished tasks' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Email the supervisor');
  await rows.first().getByRole('radio', { name: 'Next week' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('evening-journal')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('evening-summary')).toContainText('1 to next week');
  await page.getByRole('button', { name: 'Close the day' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Today|Tomorrow/ })).toBeVisible();
  await expect(page.getByText('Day closed')).toBeVisible();

  // The rolled task now carries next Monday's due date.
  const now = new Date();
  const dow = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() + (dow === 0 ? 1 : 8 - dow));
  monday.setHours(23, 59, 0, 0);
  await page.goto('/projects');
  await page.getByRole('link', { name: /Thesis/ }).click();
  const row = page
    .getByRole('list', { name: 'Project tasks' })
    .getByRole('listitem')
    .filter({ hasText: 'Email the supervisor' });
  await expect(row).toContainText(monday.toISOString().slice(0, 10));
});
