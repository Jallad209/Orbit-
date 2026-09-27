# Changelog

All notable changes to Orbit. Generated from Conventional Commits with git-cliff,
then edited by hand before each release.

## [1.0.0] — 2026-09-27

The first stable release of Orbit: a personal planner that turns your goals, routines,
commitments, bills and notes into a plan for today — on your own computer, with no account and
nothing sent anywhere. New here? [Installing Orbit](INSTALL.md) walks through it in about two
minutes.

The Windows installer is not code-signed, so Windows shows a blue "Windows protected your PC"
box the first time you open it; click **More info**, then **Run anyway**. No administrator
password is needed.

### Added

- **Weekly review** in seven resumable steps — Inbox, Overdue, Projects, Goals, Bills, Patterns,
  and Capacity — with a summary you can come back to. **Daily reviews** ask configurable morning
  questions, offer "Later today" reminders and templates, keep same-day drafts, and end with an
  evening journal. A review dashboard ties them together.
- **People and commitments**: record what you owe and what you're owed, get a follow-up reminder
  when someone goes quiet, and see each person's open promises.
- **Bills and spending**: recurring bills that keep their paid history, a spending log with
  monthly reminders, and totals kept separate per currency.
- **Notes** with safe offline editing, and links between notes, tasks, projects and people.
- **Insights**: a screen that lists what needs attention — overloaded days, weekly targets beyond
  the time you have, stale projects, estimates that keep running over, people with several open
  commitments — each showing its threshold and the records behind it. Snooze or dismiss any of
  them; tune the thresholds in Settings → Insights.
- **Command palette** (`Ctrl+K`): one box for search and commands — add a task, note or event,
  plan your day, reschedule unfinished work, open a project, go to any screen — with **Undo**.
- **Search** across tasks, notes, projects and people, tolerant of typos, with filters such as
  `type:note` and `area:name`.
- **Stays in the tray**: closing the window keeps Orbit running quietly so reminders still
  arrive; **Start at login** is available in Settings → Desktop. Reminders are prepared ahead,
  so they arrive while the window is hidden, and a notification click opens the exact record.
- **Your data stays safe**: on the desktop, daily and weekly backups that are checked after
  they're written, manual backups and one-step restore; in the browser version, a reminder to
  export when you haven't in a while. A local diagnostics bundle for bug reports holds no titles,
  names or text.

### Changed

- Reminders carry real dates ("Rent due 2026-09-20") instead of "due in 3 days".
- Project "stale" badges, Today, and the at-risk list all use the same definition of activity,
  and the stale threshold from Settings → Insights.
- The close-to-tray setting moved to Settings → Desktop; an earlier choice is carried over.
- Older export files and databases are upgraded automatically; files from a newer Orbit are
  refused rather than half-read.

### Fixed

- **Upgrading no longer breaks Orbit.** An earlier build could keep showing the previous
  version after an upgrade and stop with "could not open its data store". Upgrades now clear the
  old copy on the first run of the new version; your data, settings and backups are untouched.
- Clicking a notification while Orbit was starting could open nothing; it now always opens the
  record.
- At 400% zoom, several screens squeezed their text into a column a few letters wide; those rows
  now wrap properly.
- The note editor now has a heading, so screen-reader users can find their place on it.
- A brand-new installation no longer starts slowly the second time it opens.
- Deleting an area always asks first, reminder notifications open the right screen, and old
  daily-review drafts expire.

### Tested for this release

Keyboard, 200%/400% zoom and NVDA screen-reader passes; checks that Orbit itself opens no network
connection (see [Privacy](docs/PRIVACY.md) for the one Windows component that does); and
installed-build tests covering install, upgrade, uninstall, notification clicks, start at login,
restarts and sleep. The full record is in
[docs/testing/release-1.0/REPORT.md](docs/testing/release-1.0/REPORT.md).

## [0.1.0-alpha.2] — 2026-09-13

Unsigned pre-release: Orbit builds are not code-signed by decision (author and trusted
users only), so Windows warns once on first run. Desktop installers are NSIS only on
pre-release tags.

### Added

- Rules: four structured rule families on Settings → Rules — time constraints (no demanding
  work after a time; reserve a weekly window, optionally for one area), recurring schedules
  (a routine _n_ times a week), the rollover policy (priority → tomorrow / next Monday /
  inbox), and reminders (bills due within _n_ days; follow up after _n_ days without a reply).
  Conflicting rules are badged with the reason.
- Reminders: a queue filled from the reminder rules, delivered as system notifications by the
  desktop shell and as in-app toasts on the web while the tab is open.
- Settings: planning preferences (working window, rest boundaries, gap between blocks, default
  estimate, evening hour) now live in the data file and travel with exports; Markdown export;
  import with a dry run before anything is written; backups with one-click restore (desktop);
  a shortcuts reference; reduce-motion.
- Sessions and reviews: the work timer (survives a restart, titles the window), a completion
  prompt for tasks finished without a timer, the morning briefing and evening shutdown flows
  with rollover.

### Changed

- The storage schema is now IndexedDB v3 / SQLite v2 / export v3 (reminders and the settings
  document); older files upgrade in place.

### Fixed

- Desktop startup and data-safety stabilisation after the first pre-release.

## [0.1.0-alpha.1] — 2026-09-13

First desktop pre-release: the web app inside a Tauri shell with a real SQLite data file.

### Added

- Capture anything from one box; Orbit guesses the type and you correct it with one key.
- Areas, goals, projects with milestones, next actions, and health signals.
- The planner: a proposed day from your open tasks, energy, and rules, with a reason for every
  block; accept it and the timeline holds the commitment.
- Timeline with drag, resize, lock, and re-plan around locked blocks; routines with recurrence.
- Desktop shell (Windows): data folder of your choice, integrity check and recovery at
  startup, first-run import of a browser export, `Ctrl+Shift+Space` quick capture.
- Offline PWA build, JSON export, data-safety checks in CI.
