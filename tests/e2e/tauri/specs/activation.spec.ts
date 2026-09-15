import { $, browser, expect } from '@wdio/globals';
import { dismissFirstRun, expectTodayHeading, goto } from './helpers';

/**
 * Notification and protocol activation on the real desktop app (week 12), warm path: the
 * shell hands the main window an `orbit://` URI, the window resolves it against current data
 * and navigates — through the draft guard — or lands on the missing page; a malformed URI is
 * ignored and nothing is written. The URI reaches the bridge here through the Tauri event
 * bus, the same channel the shell uses after a click, because a second process cannot be
 * started in the isolated harness (single instance is off under ORBIT_DATA_DIR by design).
 * The cold path (process start with the URI as an argument) lives in `tests/e2e/desktop`
 * (`pnpm run e2e:desktop:cold`), which launches the binary with argv directly; the installed
 * toast click itself is a manual VM check.
 */

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await browser.execute(
    async (cmd, params) => {
      const internal = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke<R>(name: string, args: Record<string, unknown>): Promise<R>;
          };
        }
      ).__TAURI_INTERNALS__;
      try {
        return { value: await internal.invoke<T>(cmd, params) };
      } catch (error) {
        return { failure: String(error) };
      }
    },
    command,
    args,
  );
  if ('failure' in result) throw new Error(result.failure);
  return result.value;
}

/** Deliver an activation the way the shell does: the `orbit:activate` event to the main window. */
async function activate(uri: string) {
  await invoke<void>('plugin:event|emit', { event: 'orbit:activate', payload: uri });
}

/**
 * Navigate to the notes list and return its new-note input once rendered. A full-page
 * reload re-boots the desktop app (the repository re-opens through Rust), so the form
 * can take a moment to appear; wait generously rather than race the boot.
 */
async function gotoNotes() {
  await goto('/notes');
  const input = await $('[aria-label="New note title"]');
  await input.waitForExist({ timeout: 20_000 });
  return input;
}

/** The new-note form, once the notes page has rendered after a navigation. */
async function newNote(title: string) {
  const input = await gotoNotes();
  await input.setValue(title);
  await $('button=Add note').click();
  await browser.waitUntil(async () => /\/notes\/[0-9a-f-]{36}$/.test(await pathname()), {
    timeout: 10_000,
    timeoutMsg: 'the note editor did not open',
  });
  return (await pathname()).split('/').pop()!;
}

async function pathname(): Promise<string> {
  const url = new URL(await browser.getUrl());
  return url.pathname + url.search;
}

/**
 * Wait until the open note editor has registered its unsaved edit. The status label
 * ("Editing") reflects the editor's local state; the draft *store* — which the guard
 * reads through `hasDirtyDrafts()` — is updated a render later in an effect, so settle
 * briefly after the label appears to let that effect run before navigating.
 */
async function waitDirty() {
  await browser.waitUntil(
    async () => (await $('[data-testid="note-save-state"]').getText()) === 'Editing',
    { timeout: 5_000, timeoutMsg: 'the note never registered as dirty' },
  );
  await browser.pause(300);
}

describe('notification activation on desktop', () => {
  it('opens the current record, lands a deleted one on the missing page, and ignores a bad URI', async () => {
    await dismissFirstRun();
    await expectTodayHeading();

    // A note to open.
    await (await gotoNotes()).setValue('Activation target');
    await $('button=Add note').click();
    await browser.waitUntil(async () => /\/notes\/[0-9a-f-]{36}$/.test(await pathname()), {
      timeout: 10_000,
      timeoutMsg: 'the note editor did not open',
    });
    const noteId = (await pathname()).split('/').pop()!;

    // Warm activation from elsewhere in the app.
    await goto('/today');
    await expectTodayHeading();
    await activate(`orbit://note/${noteId}`);
    await browser.waitUntil(async () => (await pathname()) === `/notes/${noteId}`, {
      timeout: 10_000,
      timeoutMsg: 'the activation did not open the note',
    });
    await expect($('#note-title')).toHaveValue('Activation target');

    // A record that is gone lands on the safe page; nothing else opens.
    await $('button=Delete note').click();
    await $('[role="dialog"]').$('button=Delete').click();
    await browser.waitUntil(async () => (await pathname()) === '/notes', { timeout: 10_000 });
    await activate(`orbit://note/${noteId}`);
    await browser.waitUntil(async () => (await pathname()).startsWith('/missing?type=note'), {
      timeout: 10_000,
      timeoutMsg: 'the deleted note did not land on the missing page',
    });
    await expect($('p*=no longer exists')).toBeExisting();

    // A malformed URI is ignored: still on the missing page, nothing written.
    await activate('javascript:alert(1)');
    await activate('orbit://task/not-a-uuid');
    await browser.pause(500);
    expect((await pathname()).startsWith('/missing?type=note')).toBe(true);
    expect(await invoke<number>('resident_activation_pending')).toBe(0);
  });

  it('an activation waits behind a dirty editor until the guard is answered', async () => {
    await (await gotoNotes()).setValue('Dirty note');
    await $('button=Add note').click();
    await browser.waitUntil(async () => /\/notes\/[0-9a-f-]{36}$/.test(await pathname()), {
      timeout: 10_000,
    });
    const dirtyId = (await pathname()).split('/').pop()!;
    // Type without blurring, then an activation names the same note: no prompt, no move.
    const body = await $('#note-body');
    await body.waitForExist({ timeout: 10_000 });
    await body.setValue('unsaved text');
    await waitDirty();
    await activate(`orbit://note/${dirtyId}`); // the same note: no navigation, no prompt
    await browser.pause(300);
    expect(await pathname()).toBe(`/notes/${dirtyId}`);
    const otherId = await newNote('Other note');
    await goto(`/notes/${dirtyId}`);
    const again = await $('#note-body');
    await again.waitForExist({ timeout: 10_000 });
    await again.setValue('unsaved again');
    await waitDirty();
    await activate(`orbit://note/${otherId}`);
    const guard = await $('[data-testid="draft-guard"]');
    await guard.waitForExist({ timeout: 10_000 });
    await guard.$('button=Save').click();
    await browser.waitUntil(async () => (await pathname()) === `/notes/${otherId}`, {
      timeout: 10_000,
      timeoutMsg: 'the activation did not proceed after Save',
    });
    await goto(`/notes/${dirtyId}`);
    await expect($('#note-body')).toHaveValue('unsaved again');
  });
});
