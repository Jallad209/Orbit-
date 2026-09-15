import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import { dismissFirstRun, expectTodayHeading, goto } from './helpers';
import { betterSqliteDriver } from '@orbit/storage/test/betterSqliteDriver';
import { SESSION_DIR_FILE } from '../session';

/**
 * The reminder scheduler on the real desktop app: a "bill due within 3 days"
 * rule plus a bill due tomorrow becomes a queued reminder (written by the
 * web side), and within one poll the Rust scheduler raises the notification
 * and marks the row fired. The data file is read straight from disk through
 * a second connection — WAL lets a reader in while the app holds the file.
 */

interface ReminderRow {
  status: string;
  title: string;
}

async function reminders(): Promise<ReminderRow[]> {
  const dir = readFileSync(SESSION_DIR_FILE, 'utf8').trim();
  const driver = betterSqliteDriver(join(dir, 'data', 'orbit.db'));
  try {
    return await driver.select<ReminderRow>(
      "SELECT json_extract(data, '$.status') AS status, json_extract(data, '$.title') AS title FROM reminders",
    );
  } finally {
    await driver.close();
  }
}

describe('reminders on desktop', () => {
  it('a bill due tomorrow with a 3-day rule is delivered by the Rust scheduler within a minute', async () => {
    await dismissFirstRun();
    await expectTodayHeading();

    // The rule, through Settings → Rules.
    await goto('/settings');
    await $('button=Reminder').click();
    await $('[data-testid="reminder-form"]').$('button=Add rule').click();
    await expect($('[aria-label="Rules"]')).toHaveText('Bills due within 3 days', {
      containing: true,
    });

    // The bill, through the inbox: capture, then accept.
    await goto('/inbox');
    const capture = await $('[aria-label="Capture"]');
    await capture.setValue('Pay the electricity bill 120 tomorrow');
    await expect($('[data-testid="capture-type"]')).toHaveText('Bill');
    await browser.keys('Enter');
    await $('[role="option"]*=electricity').click();
    await browser.keys('Enter');
    await expect($('[role="option"]*=electricity')).not.toBeExisting();

    // The web side queues it at once…
    await browser.waitUntil(async () => (await reminders()).length === 1, {
      timeout: 15_000,
      timeoutMsg: 'the reminder row was not queued',
    });
    const [queued] = await reminders();
    expect(queued!.title).toMatch(/due \d{4}-\d{2}-\d{2}$/);

    // …and the Rust scheduler (60 s poll) fires it as an OS notification and marks it.
    await browser.waitUntil(async () => (await reminders())[0]?.status === 'fired', {
      timeout: 90_000,
      interval: 2_000,
      timeoutMsg: 'the scheduler did not fire the reminder within 90 s',
    });
  });
});
