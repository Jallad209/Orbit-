# Changelog

All notable changes to Orbit. Generated from Conventional Commits with git-cliff,
then edited by hand before each release.

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
