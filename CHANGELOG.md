# Changelog

All notable changes to Orbit. Generated from Conventional Commits with git-cliff,
then edited by hand before each release.

## [Unreleased]

### Added

- Weekly reviews now cover seven resumable steps—Inbox, Overdue, Projects, Goals, Bills,
  Patterns, and Capacity—with idempotent receipts and frozen summaries. People and
  commitments, recurring bills, notes, `orbit://` links, notification activation, and
  draft-safe activation complete the Week 12 workflows.
- Daily reviews ask configurable morning capture questions, support Later today reminders
  and templates, preserve same-day drafts, add an evening journal/reflection, and have a
  review dashboard. Weekly Patterns summarizes explicit time, energy, reflection tags, and
  per-currency spending without reading journal prose.
- Spending log entries and monthly reminders; explicit person follow-up dates/times; direct
  reminders for review steps, people, and spending; preferred-date planner hints; and review
  settings.
- Desktop data safety: verified daily/weekly rotating SQLite backups (the first attempt waits
  20 s after launch so it never competes with the first screen), manual backups, restore-kind
  labels, and a fresh integrity check in diagnostics. The shell logs any database command that
  waits for or holds the connection for 250 ms or more. The open-time check is now
  `PRAGMA quick_check`, run once per connection rather than once per window; the full
  `integrity_check` stays on every verified backup copy and in Diagnostics. The first insights
  scan waits out its 3 s initial delay even when boot itself writes. A window that reloads
  releases the transaction its previous document owned at once, so the next document no
  longer waits up to 30 s on "Opening Orbit…". The web now reminds after
  more than seven days and 100 changes without a full JSON export.

- Command palette: `Ctrl+K` (or the Search button on the rail) opens one box for commands and
  search. Commands — add task / note / event, plan my day, regenerate today's proposal,
  reschedule unfinished work, show neglected goals, review this week, open project, go to any
  screen — validate their input inline and offer **Undo** on the toast (this session, last 20).
- Global search across tasks, notes, projects, and people, with prefix and typo tolerance,
  `type:note` / `area:name` filters, highlighted snippets, and a `/search` page whose URL is
  the state. Desktop uses SQLite FTS5 inside the data file when available; the web (and a
  SQLite without FTS5) uses an in-memory index. Notes and people open in a read-only preview.
- Local diagnostics, never telemetry: rolling JSON logs on desktop (daily, 10 MB, seven kept)
  with a redacting writer and a crash marker; a bounded event buffer on the web; Settings →
  Data → **Save diagnostics bundle** writes a zip (desktop) or JSON (web) that holds versions,
  counts, and error kinds — no titles, bodies, names, queries, or paths. See
  `docs/BUG-REPORTS.md`.

- Insights: an **Insights** screen (and `g o`, or the "Open insights" command) lists what
  needs attention — overloaded days, weekly area targets beyond available time, stale
  projects, estimates that run over, and people with several open commitments — each with its
  threshold visible and the records and arithmetic behind it. Snooze for a day, a week, or
  until the data changes; dismiss until restored; history with Restore. Today shows the first
  three; the Timeline warns about an overloaded day and links to the evidence. Thresholds are
  in Settings → Insights. See `docs/INSIGHTS.md`.
- Desktop: Orbit stays in the **system tray** when the window is closed (Open Orbit, Quick
  Capture, Plan my day, Quit); the first close explains this. One Orbit process: launching it
  again brings the window back. **Start at login** is opt-in in Settings → Desktop and shows
  what Windows actually has registered. Reminders for known bills and follow-ups are prepared
  ahead with their dates, so they arrive while the window is hidden. See
  `docs/RESIDENT-BEHAVIOUR.md`.

### Changed

- Restoring a backup made before the search index existed is accepted; the index is rebuilt on
  the next open.
- Project "stale" badges, the Today screen, and the at-risk list now share one definition of
  activity (a project's own change, its tasks and milestones — including deleting one — and
  sessions) and the stale threshold from Settings → Insights.
- Reminder wording carries dates ("Rent due 2026-09-20", "No reply on … since 2026-09-10")
  instead of "due in 3 days".
- Export schema is now 6 / IndexedDB 5 / SQLite 4. Older formats migrate forward; newer
  formats are still refused.
- Close-to-tray moved from Settings → Data to Settings → Desktop; the earlier setting is
  carried over once.

### Fixed

- PD-001: cold `orbit://` and notification activation waits for a subscribed frontend and
  is acknowledged before the native queue entry is removed, so startup races no longer
  silently lose the destination.
- Area deletion always requires confirmation, direct reminder toasts open their exact
  destination, old daily-review drafts expire, and spending totals remain separated by
  currency.

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
