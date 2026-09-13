import { $, browser, expect } from '@wdio/globals';

/**
 * The first core-loop scenario, on the real desktop app: first run, capture
 * three items, file one into a project, and find everything still there
 * after the window reloads (SQLite this time, not IndexedDB).
 */

/** Navigate within the app: the SPA serves index.html for every route. */
async function goto(path: string) {
  const origin = new URL(await browser.getUrl()).origin;
  await browser.url(`${origin}${path}`);
}

async function createArea(name: string) {
  await goto('/areas');
  const input = await $('input[aria-label="Area name"]');
  await input.setValue(name);
  await $('button=Add area').click();
  await expect($(`[aria-label^="Area name ${name}"]`)).toBeDisplayed();
}

describe('core loop on desktop', () => {
  it('first run lands on Today with a fresh data folder', async () => {
    const start = await $('button=Start planning');
    await start.waitForDisplayed({ timeout: 30_000 });
    await start.click();
    await expect($('h1=Today')).toBeDisplayed();
  });

  it('captures three items, files one into a project, and keeps everything after a reload', async () => {
    await createArea('Study');

    await goto('/projects');
    await $('input[aria-label="Project title"]').setValue('Thesis');
    await $('button=Add project').click();
    await expect($('a*=Thesis')).toBeDisplayed();

    await goto('/inbox');
    const capture = await $('[aria-label="Capture"]');
    for (const text of [
      'Submit my report next Friday',
      'Pay electricity bill every month',
      'Remind me to ask Omar about his interview',
    ]) {
      await capture.setValue(text);
      await expect($('[data-testid="capture-type"]')).toBeDisplayed();
      await browser.keys('Enter');
    }
    await expect($('[role="group"][aria-label="Tasks"]')).toBeDisplayed();
    await expect($('[role="group"][aria-label="Bills"]')).toBeDisplayed();
    await expect($('[role="group"][aria-label="Commitments"]')).toBeDisplayed();

    // Assign the task to the project with the keyboard.
    await $('[role="option"]*=Submit my report').click();
    await browser.keys('p');
    const popover = await $('[role="dialog"][aria-label="Assign project"]');
    await popover.$('button=Thesis').click();
    await expect($('[role="option"]*=Submit my report')).not.toBeExisting();

    // Data is in the SQLite file: a full reload keeps it.
    await browser.refresh();
    await expect($('[role="group"][aria-label="Bills"]')).toBeDisplayed();
    await expect($('[role="option"]*=Pay electricity bill')).toBeDisplayed();

    await goto('/projects');
    await $('a*=Thesis').click();
    const list = await $('[role="listbox"][aria-label="Project tasks"]');
    await expect(list.$('[role="option"]*=Submit my report')).toBeDisplayed();
  });
});
