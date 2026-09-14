# Resident behaviour (Windows desktop)

Since week 11 the desktop shell stays available after the main window is closed: one
process, one tray icon, reliable manual launch, opt-in launch at login, and an explicit
Quit. This page records the policy, who owns each setting, how recovery works, and what was
and was not verified. The shell code is `apps/orbit/src-tauri/src/{resident,tray,prefs,autostart,scheduler}.rs`;
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

### Readiness

"Resident reminders: ready" in Settings → Desktop means: the correct generation is open,
settings and native preferences migrated, the initial queue reconciliation committed, and
the native scheduler is active for that generation. Before that the section says "starting";
after a Quit that could not finish it says "needs attention" with the reason.

## Shutdown

Quit runs off the event loop:

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
and the rule's watermark immediately before delivery; cancelled rows are tombstones that
can revive, fired and dismissed rows are terminal history. An OS notification failure is
logged (without record contents) and retried on the next pass. Windows accepting a
notification is not proof that a toast was visible: Focus Assist and notification settings
can hide it, and Settings says so.

Nothing is delivered while the computer sleeps or Orbit is not running; due rows catch up
when it can run again, subject to the per-pass cap.

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
- after uninstall: if the uninstaller is running in place (`$EXEPATH == $INSTDIR\uninstall.exe`,
  which is how an upgrade invokes the previous version's uninstaller) keep the value;
  otherwise delete the value only if it points at this installation, plus its
  StartupApproved counterpart. The Run key itself, the data folder, exports, backups, and
  `desktop-preferences.json` are never removed.

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

Installed build (clean VM procedure in `docs/WEEK-11` plan §14.6): **NOT RUN** in this pass.
No VM or disposable account was available. Until it is, the following remain pending and
resident delivery is not marked complete on an installed build:

- installed Orbit name and icon on notifications; Focus Assist behaviour;
- install → enable login launch → reboot → hidden initialization → reminder delivery;
- sleep/resume across a due time without duplicate delivery;
- upgrade with the opt-in retained and the executable target refreshed;
- disable → reboot → no auto-launch; uninstall cleanup with data and backups retained;
- duplicate manual launch against the real single-instance registration (skipped under test
  isolation by design);
- forced termination, then one honest unclean-run report and recovery.

MSI: **BLOCKED as a stable-release gate**. The hook above is NSIS-only; equivalent MSI
cleanup must be implemented and verified before an MSI channel ships.
