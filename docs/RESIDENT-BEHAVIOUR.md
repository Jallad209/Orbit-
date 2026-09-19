# Resident behaviour (Windows desktop)

Since week 11 the desktop shell stays available after the main window is closed: one
process, one tray icon, reliable manual launch, opt-in launch at login, and an explicit
Quit. Week 12 added notification activation and the `orbit://` protocol, and made Quit
wait for unsaved drafts. This page records the policy, who owns each setting, how recovery
works, and what was and was not verified. The shell code is
`apps/orbit/src-tauri/src/{resident,tray,prefs,autostart,scheduler,notifications,activation}.rs`;
the main window's side is `apps/orbit/src/features/desktop/`.

## Lifecycle policy

One coordinator (`resident.rs`) owns why the process started, whether it is ready, what
closing the main window means, and how the process ends.

| Event                                        | Result                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| Manual launch                                | Main shows and focuses; one tray, one scheduler                             |
| Manual launch while hidden in the tray       | The existing window is shown, unminimized, focused; no second process       |
| Launch at login (`--background`)             | Main initializes hidden; readiness is reported when it comes                |
| Second launch with `--capture`               | The existing capture window opens                                           |
| Duplicate launch at login                    | Ignored: the running instance keeps its focus                               |
| First run or a startup failure               | Main is visible with onboarding or the error                                |
| X, close-to-tray on, tray available          | Main hides; the webview, database, capture window, and reminders stay alive |
| X, first time                                | The explanation is shown first; hiding waits for "Hide to tray"             |
| X, close-to-tray off, or no tray this run    | Orderly shutdown                                                            |
| X before preferences have settled            | Main stays; a notice says startup is still completing                       |
| Tray: Open Orbit / left click                | Show, unminimize, focus the existing main window                            |
| Tray: Quick Capture / Ctrl+Shift+Space       | Open the existing capture window; closing it hides it                       |
| Tray: Plan my day                            | Show main and open Today in proposal mode; nothing is accepted for you      |
| Tray: Quit                                   | Orderly shutdown regardless of the close preference                         |
| Tray cannot be created                       | Main stays reachable; close-to-tray is off for the run and Settings says so |
| Background launch never becomes ready (30 s) | Main is shown so the error is reachable                                     |
| Restore or relocate                          | Generation changes; the scheduler waits until the reloaded window is ready  |

A hidden main window is not a headless app. The webview keeps running, keeps the database
open, and keeps reconciling reminders; the native scheduler only delivers rows the frontend
prepared.

### Startup order

1. `tauri-plugin-single-instance` first, before logging, the shortcut, the database, or the
   scheduler are claimed. Its callback accepts only `--background` and `--capture`; any
   other argument (a URL, a command) means "show the main window" and nothing else.
2. Dialog, notification, opener, autostart (`Orbit`, `--background`), global shortcut,
   window state (size, position, maximized — never visibility).
3. The main window is created hidden (`visible: false`); the launch policy decides.
4. Native preferences load; an enabled login registration is refreshed to the current
   executable; the tray is built.
5. The frontend mounts, opens and migrates the database, transfers the legacy close
   preference, and reconciles reminders once.
6. The main window (only) acknowledges readiness for the open database generation. A stale
   generation or another window is refused. The scheduler starts delivering only then.
7. After each ready scheduler tick, the shell takes the day's verified online backup if it
   does not already exist. UTC dates name the files; the same minute loop covers a process
   that remains resident for days.

### Readiness

"Resident reminders: ready" in Settings → Desktop means: the correct generation is open,
settings and native preferences migrated, the initial queue reconciliation committed, and
the native scheduler is active for that generation. Before that the section says "starting";
after a Quit that could not finish it says "needs attention" with the reason.

## Shutdown

Before the sequence below starts, Quit asks (week 12): every live window that holds drafts
is asked to save or discard them and to acknowledge with the request id and the database
generation id. The main window saves every registered draft through the same guard that
protects in-app navigation; a hidden capture window with text comes forward and offers
Save capture, Discard, or Cancel quit — its text is never silently turned into a record. A
refusal, a failed save, a stale acknowledgment, or no acknowledgment cancels the quit and
the app stays reachable with the reason and a "discard and quit" choice. An OS kill cannot
be made transactional with an unsaved textarea: only acknowledged saves survive forced
termination.

Quit then runs off the event loop:

1. enter Quitting; the shell refuses new independent writes with "Orbit is quitting; this
   change was not saved" (a transaction that already owns the connection may finish);
2. stop the scheduler thread: it waits on a channel, not a sleep, so the stop returns within
   one bounded join (5 s);
3. wait up to 10 s for an owned transaction to settle (an abandoned one expires);
4. close the process-owned database;
5. save window state, mark the run clean, exit every window and the process.

If a write cannot settle or the file will not close, Orbit stays visible with the error and
Quit can be retried; the run is not marked clean. Only an orderly shutdown marks it clean:
a forced termination or an OS session end that interrupts the sequence leaves the marker
unclean and the next launch reports it honestly. Running timer sessions are not touched by
shutdown; they resume from their stored instants as before.

## Reminders while resident

The TypeScript side prepares rows; the Rust scheduler delivers them. Since week 11 every
known bill and open owed-to-me commitment gets its row when it is known, with its real
future fire time, so a reminder for tomorrow morning exists tonight even if the window is
hidden. Wording carries explicit dates ("Rent due 2026-09-20", "No reply on … since
2026-09-10"), never "in 3 days" frozen at preparation time. One row per stored source: a
recurring bill's later occurrences do not exist until the bill does.

Reconciliation runs at startup, every minute, after any write, and on window focus or
visibility (a resumed machine, a returning user); after it writes rows it wakes the
scheduler so the first eligible batch starts within two intervals of readiness or resume.
The scheduler keeps its 20-per-pass cap and validates every row against its live sources
immediately before delivery. Rule rows also require the rule watermark; direct
`review-step`, `person-follow-up`, and `monthly-spending` rows do not require a rule, but
their draft, person/schedule, or pending spending source must still be live and unchanged.
Cancelled rows are tombstones that
can revive, fired and dismissed rows are terminal history. An OS notification failure is
logged (without record contents) and retried on the next pass. Windows accepting a
notification is not proof that a toast was visible: Focus Assist and notification settings
can hide it, and Settings says so.

Nothing is delivered while the computer sleeps or Orbit is not running; due rows catch up
when it can run again, subject to the per-pass cap.

## Automatic backups

The scheduler creates a verified SQLite online snapshot in `<data>/backups` once per UTC
day, only after the current database generation is ready and while no transaction or Quit
owns the database. It keeps seven daily, four weekly, three manual, and three
before-restore copies; unknown `.db` files are never pruned. A daily copy is promoted to a
weekly copy when the newest weekly is at least seven days old. Settings → Data can create a
manual copy and restore every listed kind. Snapshots include committed WAL contents, switch
to a single-file DELETE journal, pass integrity/schema/row-count verification, and are
published without clobbering an existing name. Restore preserves the live database first.

Since week 12 a delivered toast carries a launch payload. The notification plugin forwards
title and body only and cannot report whether Windows accepted the toast, so on Windows
`notifications.rs` talks to the WinRT toast API directly: the toast XML carries
`launch="orbit://reminder/<id>" activationType="protocol"` and the reminder id as its tag inside the
`orbit-reminders` group (so a re-prepared reminder replaces its notification-center entry
rather than adding one), and `show` returns the immediate submission result. A submission failure
leaves the row pending for the next pass; "fired" means Windows accepted the toast, never
that the user saw it. Other platforms fall back to the plugin without a payload.

## Activation (`orbit://`)

An `orbit://<kind>/<uuid>` argument reaches the process from a notification click, the
protocol handler, or a second launch forwarded through single instance. The contract and
the resolver are documented in `docs/DEEP-LINKS.md`; the shell's part is:

- validate the argument with the strict Rust parser (`activation.rs`); anything else is
  ignored and only the kind is logged, never the id;
- show the main window whatever the launch mode (`--background` included) and queue the
  URI until the frontend has acknowledged readiness for the current database generation
  **and** the main window's `orbit:activate` listener has subscribed — a cold notification
  click races frontend readiness, and the shell waits rather than emitting into a window
  that is not yet listening;
- deliver with acknowledgment: each attempt is bracketed with the listener's subscription
  generation; the queue entry is dropped only after a successful emit to that same
  subscription, a failed emit drops the stale subscription so the entry waits for the next
  listener, and a renderer that unmounts or reloads explicitly unsubscribes so no click is
  lost into a dead window;
- collapse duplicate deliveries of one activation through more than one API within 1.5 s,
  while a later deliberate click counts again;
- never create another database owner: a forwarded launch hands the URI to the running
  process and exits.

The frontend parses the URI again, resolves it against current data, and navigates
through the draft guard; a dirty editor asks first, reopening the record already on
screen never prompts, a missing record lands on `/missing`, and first-run onboarding holds
the destination until "Start planning". An activation only navigates.

## Preferences and who owns them

Machine-local preferences live in `desktop-preferences.json` beside the shell's
`settings.json` (never in the data file, never in an export):

| Preference             | Default | Owner                                                          |
| ---------------------- | ------- | -------------------------------------------------------------- |
| `closeToTray`          | on      | Settings → Desktop; disabled for a run without a tray          |
| `closeExplanationSeen` | off     | Set when the first-close explanation is acknowledged           |
| `autostart`            | off     | What you asked for; the OS registration is what actually holds |
| `legacyCloseMigrated`  | off     | Set once the week-10 flag was transferred                      |

Legacy close preference: the main window sends the raw `orbit-close-to-tray` localStorage
value once. An explicit "0" stays off, an explicit "1" stays on, anything else adopts the
new default. Until this has happened a close is held (not hidden, not quit) and explained.
Importing data never touches these preferences, the registration, or the data folder.

### Login launch

Opt-in only, from Settings → Desktop. The registration is a per-user Run value
(`HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Orbit = "<exe> --background"`) written
by `tauri-plugin-autostart`; no administrator rights, no machine-wide entry. Every read
goes back to the registry, after a change and whenever the section opens; if a change
fails, the toggle shows the real state and the error. At startup an enabled registration is
rewritten to the current executable, so an installation path change cannot leave it
pointing at a missing file.

### Installer (NSIS)

`apps/orbit/src-tauri/windows/hooks.nsh`:

- after install: if the Run value exists and names `Orbit.exe`, rewrite it to the executable
  just installed;
- after install (week 12): register the `orbit://` protocol for this user under
  `HKCU\Software\Classes\orbit` (`URL Protocol`, the icon, and
  `shell\open\command = "<exe>" "%1"`, quoted). If a command already exists there and does
  not name `Orbit.exe`, another program owns the scheme and it is left alone; the app then
  reports the missing handler instead of hijacking it;
- after uninstall: if the uninstaller is running in place (`$EXEPATH == $INSTDIR\uninstall.exe`,
  which is how an upgrade invokes the previous version's uninstaller) keep both
  registrations for the new version; otherwise delete the Run value and the protocol
  command only if they point at this installation. The Run key itself, another
  application's `orbit` handler, the data folder, exports, backups, and
  `desktop-preferences.json` are never removed.

The app itself never writes the protocol registration; only the installer does. Automated
desktop tests run the binary, not the installer, and hand it `orbit://` arguments directly,
so they never touch the developer's registry (see Test isolation).

The MSI channel is separate. This hook is NSIS-only and is no evidence for MSI; MSI cleanup is
an explicit gate for a stable release (see verification).

## Notification identity

Production identifier `app.orbit.desktop`, product name `Orbit`. An installed build's
notifications carry the Orbit name and icon through the shortcut the installer creates; a
development run under PowerShell shows PowerShell's identity instead and proves nothing.

## Test isolation

Automated desktop tests (`pnpm run e2e:desktop`) set `ORBIT_DATA_DIR`,
`WEBVIEW2_USER_DATA_FOLDER`, and `ORBIT_AUTOSTART_FAKE`. Under `ORBIT_DATA_DIR` the shell
also keeps preferences, logs, and the crash marker beside that folder, uses a file instead of
the registry for login launch, and registers neither single instance (which would activate
the user's running Orbit) nor window state (which would write to the user's profile). No
test terminates Orbit processes broadly or touches the host profile. Real registry, install,
reboot, and upgrade cases belong in a disposable VM or account.

## Verification record

Automated (this repository, run on the developer machine, Windows 11 Pro 10.0.26200):

| Check                                                                 | Result                                      |
| --------------------------------------------------------------------- | ------------------------------------------- |
| Launch-argument allowlist, close-policy matrix, tray routing          | PASS — `cargo test` (resident, tray, prefs) |
| Shutdown refuses new transactions, lets an owned one finish           | PASS — `cargo test` (db)                    |
| Preferences round-trip, legacy transfer once, bad file tolerated      | PASS — `cargo test` (prefs)                 |
| Readiness handshake for the open generation; stale generation refused | PASS — `e2e:desktop` resident.spec          |
| First close explains, hides on acknowledge; later closes hide; Open   | PASS — `e2e:desktop` resident.spec          |
| Login launch opt-in with read-back against the fake backend           | PASS — `e2e:desktop` resident.spec          |
| Quit stops in order and marks the run clean                           | PASS — `e2e:desktop` zz-resident-quit.spec  |
| Reminder rows prepared ahead with date-stable wording; fired natively | PASS — `e2e:desktop` reminders.spec         |
| Legacy close flag, tray navigation, explanation, quit failure notices | PASS — vitest ResidentBridge                |
| Settings shows real state, refuses an optimistic toggle on OS failure | PASS — vitest DesktopSettings               |

Week 12 (activation, protocol, quit preparation), automated on the same machine:

| Check                                                                                                           | Result                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orbit://` parser: 39 shared vectors accepted/rejected identically in Rust and TypeScript                       | PASS — `cargo test` (activation), vitest `lib/destinations`                                                                                                                        |
| Toast XML carries the launch payload, tag, and group; submission result returned                                | PASS — `cargo test` (notifications)                                                                                                                                                |
| Activation queued until readiness + listener; acknowledged delivery; failed/stale emit stays queued             | PASS — `cargo test` (resident: 54 tests incl. failed-emission, stale subscription, delayed cleanup, newer-click retention)                                                         |
| Warm activation opens the current record, deleted lands on `/missing`, bad URI ignored, waits on a dirty editor | PASS — `e2e:desktop` activation.spec                                                                                                                                               |
| Cold activation against the real release binary: task / bill / commitment / deleted / malformed, first run      | PASS — `e2e:desktop:cold` 3/3; isolated-install stress 30/30; reused-session race 20/20 (was ~8–17 % lost before the post-review fix, `docs/testing/campaign-2026-09-15/FIXES.md`) |
| Quit saves registered drafts and acknowledges with request + generation ids; refusal keeps the app up           | PASS — vitest ResidentBridge (mocked shell); not exercised end-to-end against the binary                                                                                           |
| Hidden capture with text offers Save capture / Discard / Cancel quit                                            | PASS — vitest QuickCaptureWindow                                                                                                                                                   |
| Scheduler pre-delivery validation: paid bill, completed/deleted commitment, deleted person, watermark           | PASS — `cargo test` (scheduler)                                                                                                                                                    |

Installed build, Windows Sandbox, 19 September 2026 — candidate
`Orbit_0.1.0-alpha.2_x64-setup.exe` (SHA-256 `AF05DA3B…441991`, tree `1a2dc6a`), harness at
`tests/installed/`, evidence in `docs/testing/release-1.0/installed/`:

| Scenario                                                                                                     | Result                                                                              |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Fresh silent NSIS install: executable, uninstaller, `orbit://` registration, data folder                     | PASS — `installed-state.json`                                                       |
| Foreign `orbit://` handler survives a reinstall untouched                                                    | PASS — `foreign-handler-after-reinstall.txt`                                        |
| Orbit reports that another program owns `orbit://`                                                           | **FAIL — not implemented**; Settings → Desktop shows only static text (fix pending) |
| `orbit://task/<id>` while visible: existing process, exact record, one process after handover                | PASS — `protocol-dispatch.json`, settled in 260 ms                                  |
| Same while hidden in the tray: existing window restored on the record                                        | PASS — `04-hidden-activation.json`                                                  |
| Same while exited: exactly one process cold-started straight onto the record, no first-run screen            | PASS — `05-cold-activation.json` (PD-001's real-world path)                         |
| Duplicate manual launch activates the running instance                                                       | PASS — `06-duplicate-launch.json`                                                   |
| Forced termination → one honest unclean-run report, app usable                                               | PASS — `07-last-run.json` (`endedCleanly: false`, `crash: null`)                    |
| A → B upgrade (alpha.1 over alpha.2, then alpha.2): data, protocol ownership, executable target refreshed    | PASS — `08-after-upgrade.json` (hash back to the candidate's)                       |
| Uninstall removes only Orbit's login value and protocol key, leaves a foreign handler, keeps every data file | PASS — `09b-after-uninstall.json`, `09b-uninstall-full.png`                         |
| Notification refused by Windows stays pending and is retried; delivered once the platform is back            | PASS — `10-shell.log`: three `0x803E0105` refusals, then `deliver fired: 1`         |
| Installed notification carries the Orbit name and icon                                                       | PASS — `11-notification-centre.png`                                                 |

Still **NOT RUN** (need the disposable `OrbitTest` host account, not Sandbox): login launch →
reboot → hidden initialization → delivery; disable → reboot → no launch; sleep across a due time
→ one delivery.

MSI: **BLOCKED as a stable-release gate**. The hook above is NSIS-only; equivalent MSI
cleanup must be implemented and verified before an MSI channel ships.
