# Orbit — Week 13 Detailed Implementation Plan

## 1. Outcome, baseline, and scope

Make Orbit trustworthy for daily use over years and ship it as 1.0: the data layer backs itself up and proves its performance at 50k records, the interface passes an accessibility audit, both runtimes are locked down and shown to make no network calls, the installed Windows build is finally verified on a disposable machine, and the post-Week-12 UI work is documented, tested, and tidied.

This document is a plan, not an implementation or verification report. Unchecked gates remain future work.

- Prepared: 17 September 2026.
- Repository baseline: 19888d2 — docs: record desktop UX critique. Week 12 closed at 8042efd (16 September 2026); the post-closeout UI work landed as d832130 — feat: improve offline reviews and spending (107 files).
- Current data versions: SQLite 4, IndexedDB 5, JSON export 6. Fixtures exist for every version under tests/fixtures/{sqlite,db,idb,export}.
- Current application version: 0.1.0-alpha.2.
- Inputs: docs/BACKEND-TASKS.md, docs/FRONTEND-TASKS.md, docs/DEVOPS-TASKS.md (Week 13 sections), docs/WEEK-12-PLAN.md, docs/testing/campaign-2026-09-15/{FINDINGS,REPORT,FIXES}.md, docs/testing/design-critique-2026-09-16/REPORT.md, docs/RESIDENT-BEHAVIOUR.md, and the current source.
- Developer machine: Windows 11 Pro 26200, 32 GB, hypervisor present. The Windows Sandbox feature (`Containers-DisposableClientVM`) is enabled and waits for a reboot.
- Recommended estimate for one developer: 14 focused working days plus 2 contingency days for Windows verification and audit fallout. "Week 13" is a milestone, not a promise to fit this scope into five calendar days.

### Decisions fixed before planning

| Decision                       | Choice                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Release target                 | v1.0.0, NSIS-only, unsigned. MSI leaves the stable targets until its cleanup gate passes. Signing stays skipped.       |
| Encryption at rest             | None in 1.0. Rely on OS disk encryption; exports, backups, and logs are plaintext. Documented, not implemented.        |
| Mobile PWA layouts             | Deferred to the post-launch plan (§15). Week 13 does narrow-desktop only.                                              |
| Dark theme                     | Deferred to 1.1. The Appearance copy that promises it "in week 13" is corrected.                                       |
| Disposable Windows environment | Windows Sandbox for install/protocol/activation scenarios; a throwaway local account on the host for reboot and sleep. |
| Optional updater               | Still not selected (Week 12 decision). No updater scope.                                                               |

### Finished experience

1. Orbit on desktop takes a verified daily backup on its own, keeps seven daily and four weekly copies, and restores any of them from Settings.
2. Orbit on the web reminds you to export once a week when you have actually changed things, and stops nagging once you do.
3. With 50 000 tasks and 10 000 notes, both runtimes reach an interactive Today inside the startup budget, and the numbers are recorded.
4. Every screen works by keyboard, reads correctly in NVDA, passes an automated accessibility scan with no serious issues, and every text/background pair meets contrast.
5. The capture window cannot call restore, quit, or file-writing commands; both runtimes enforce a strict content-security policy; a CI job proves the dependency tree is clean and that no request ever leaves the app.
6. The installed NSIS build's notification clicks, protocol registration, upgrade, uninstall, single instance, autostart-after-reboot, and forced-termination behaviour are recorded PASS/FAIL from a real disposable Windows session, not assumed.
7. v1.0.0 is published with an installer, a PWA bundle, checksums, a current changelog, and a docs index; the morning check-in, review dashboard, journal, spending log, and review settings from d832130 are documented and tested.

### Scope table

| Track                | Required Week 13                                                                                                             | Boundary                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Post-Week-12 absorb  | Green browser e2e, tests for the new screens, code loose ends, feature docs, changelog, roadmap rows                         | No redesign of the new flows; fix and document what shipped       |
| Data safety          | Daily/weekly backup rotation with restore, manual backup, web export reminder, fresh integrity in diagnostics                | No encryption, no cloud sync, no new storage schema               |
| Performance          | 50k startup budgets on both runtimes, adapter-level bench, page-level measurements, WebKit stall classified                  | No engine rewrites; budgets are asserted, not tuned speculatively |
| Accessibility/polish | axe per route, contrast checker, motion test, narrow-desktop breakpoints, critique leftovers, A11Y-AUDIT.md                  | No mobile layouts, no dark theme, no icon redesign                |
| Security             | App-command ACL per window, strict CSP on both runtimes, audit job with deny.toml, zero-network proof, SECURITY/PRIVACY docs | No new plugins, no telemetry, no network features to lock down    |
| Installed Windows    | Sandbox harness and checklist, host-account reboot/sleep scenarios, results recorded                                         | No MSI verification; MSI is removed from stable targets           |
| Release              | 1.0.0 version, changelog, docs index, full gate, tag, Sandbox smoke, Phase I campaign rerun                                  | Unsigned; no updater; no mobile claims                            |

### Carry forward the honest Week 12 verification status

docs/RESIDENT-BEHAVIOUR.md (Verification record) lists the installed-build scenarios as NOT RUN in both the Week 11 and Week 12 passes because no VM or disposable account existed. docs/testing/campaign-2026-09-15/REPORT.md §4 calls the installed clean-machine pass "the definitive check for PD-001's real-world path and a release gate". Week 13 supplies the environment (§9) and runs it before tagging. The Week 12 page-level performance measurements at 50k were not added; §6 closes that.

The three roadmap summary tables still show Week 12 as `⏳ PENDING 0%` (docs/BACKEND-TASKS.md:825, docs/FRONTEND-TASKS.md:830) or `PENDING` where the section says NOT SELECTED (docs/DEVOPS-TASKS.md:693). §4 corrects them; they are stale rows, not open work.

## 2. Recommended execution order

| Order | Work package                                                                      | Exit gate                                                                                   |
| ----- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 0     | Absorb d832130: e2e green, new-screen tests, loose ends, docs, changelog, roadmap | `pnpm test` and `pnpm e2e` green at the new baseline; every new screen has a doc and a test |
| 1     | Backup rotation, export reminder, diagnostics freshness                           | Rotation keeps exactly 7 + 4; a rotated backup restores; reminder predicate tested          |
| 2     | Performance at 50k on both runtimes                                               | Budgets asserted in CI; adapter and page-level numbers recorded                             |
| 3     | Accessibility, contrast, motion, narrow desktop, critique leftovers               | axe zero serious/critical per route; contrast checker green; docs/A11Y-AUDIT.md written     |
| 4     | Security: ACL, CSP, audit CI, zero-network proof, SECURITY/PRIVACY docs           | Both desktop harnesses green under the ACL; CSP violations = 0; audit job green             |
| 5     | Installed-build verification in Sandbox and on the host account                   | RESIDENT-BEHAVIOUR.md verification record updated with PASS/FAIL/NOT RUN per scenario       |
| 6     | 1.0.0 release                                                                     | v1.0.0 published (NSIS, PWA zip, SHA256SUMS); Phase I rerun recorded                        |

Package 0 goes first so every later measurement is taken against a green baseline. Packages 1–4 are independent and may interleave. Package 5 needs the Week 13 candidate installer, which must include package 4's capability and CSP changes. Package 6 is last.

With two developers: one takes packages 1–2 (Rust and bench), the other packages 3–4 (frontend and CI). Package 0 is shared and finishes before either starts; package 5 is a joint day.

## 3. Baseline and architecture rules

### 3.1 Preflight

- Record HEAD, branch, git status, tool versions, and the current test/benchmark results with tests/campaign/snapshot.ts.
- Use checked-in lockfiles. Do not refresh unrelated dependencies; the audit job (§8.3) reports on the tree as it is.
- Distinguish the known browser e2e failures caused by d832130 (§4.1) from regressions before changing code.
- Protect old migration SQL and versioned fixtures. No schema change is planned this week; if one becomes necessary it needs the full fixture matrix.
- Prepare disposable test data (tests/campaign/desktop/seedDb.ts and scripts/seed.ts), never changes to the user's real data folder, registry, or startup registration.
- Never run an installer, a `tauri build`, or Windows Sandbox from inside the Claude desktop app's process tree: MSIX virtualisation redirects `%LOCALAPPDATA%` writes into the app's package cache (see docs/testing/campaign-2026-09-15/FIXES.md, Firefox entry). Builds and installs run from the user's own terminal.
- Run Vitest from an idle machine in the user's context; the suite is load-sensitive.
- Delete the empty stray files out.txt and err.txt at the repository root.

### 3.2 Reuse map

| Existing code                                                                                                   | Reuse / required adaptation                                                                                     |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| apps/orbit/src-tauri/src/commands/data_dir.rs (`data_restore_backup`, `verify_copy`)                            | Online-backup snapshot sequence, extracted into one helper shared by relocate, restore, and backup              |
| apps/orbit/src-tauri/src/scheduler.rs thread loop and `resident::scheduler_may_run`                             | The readiness-gated minute tick that also drives the daily backup                                               |
| apps/orbit/src/features/settings/BackupList.tsx, apps/orbit/src/platform/desktop.ts                             | Backup list and bridge; add "Back up now" and backup kinds                                                      |
| packages/storage/src/repository.ts `opLog.latestSeq()`, packages/storage/src/export/json.ts envelope `opLogSeq` | Operation count since the last export                                                                           |
| apps/orbit/src/app/store.ts `readSessionFlag` / `writeSessionFlag`                                              | Session-only dismissal of the export reminder                                                                   |
| scripts/seed.ts, tests/e2e/playwright/startup.spec.ts                                                           | 50k dataset and the browser startup budget; extend sizes, keep 5k in the default e2e                            |
| tests/e2e/desktop/coldLaunch.ts (`spawnToCdpMs`, `spawnToMainPageMs`)                                           | Desktop startup timings and the CDP session for network capture                                                 |
| packages/storage/test/betterSqliteDriver.ts                                                                     | Node SQLite driver for adapter-level benches                                                                    |
| apps/orbit/src/lib/useMediaQuery.ts `NARROW_QUERY`                                                              | Narrow-width switch already used by the timeline                                                                |
| `EmptyState`, `toastStore` action slot (added in d832130)                                                       | Shared empty states and undoable toasts                                                                         |
| tests/e2e/playwright/notes.spec.ts:13–14, 51–52                                                                 | Request-recording pattern, promoted to an auto fixture                                                          |
| tests/campaign/{run-stage,snapshot}.ts, tests/campaign/desktop/seedDb.ts                                        | Evidence stages, tree/binary hashes, disposable dataset                                                         |
| apps/orbit/src-tauri/windows/hooks.nsh                                                                          | The registry behaviour under test in Sandbox (POSTINSTALL foreign-handler check, POSTUNINSTALL ownership check) |
| scripts/bump-version.ts, scripts/changelog.ts, cliff.toml, .github/workflows/release.yml, docs/RELEASE.md       | Release mechanics                                                                                               |

### 3.3 Rules

- Core stays pure; storage/application services own transactions; native code owns files, processes, and OS integration. No new business rule lives in a React component.
- A backup is a verified, single-file copy produced by SQLite's online backup API while Orbit holds its own database lock. Never a file copy of a live WAL database.
- Evidence is a file under docs/testing/release-1.0/ with the commit, build hash, command, and observed outcome. A missing environment is recorded as NOT RUN; it is never permission to tick a box.
- Any command reachable from the WebView is in a per-window capability list. A command that is not listed fails with an ACL error, by design.
- No scope from §15 (mobile, dark theme, MSI, updater, encryption) is added quietly. If a task needs one, stop and record the decision.

## 4. Absorb the post-Week-12 changes (d832130)

d832130 added the morning check-in questions (`features/reviews/MorningCheckIn.tsx`), the resumable daily-review draft and reflection persistence (`dailyReviewService.ts`), a review dashboard at `/review` (`ReviewDashboard.tsx`), an evening Journal step, the weekly "Patterns" step over a new trend report (`packages/core/src/services/trends.ts`), a spending log with monthly reminders (`features/bills/SpendingPanel.tsx`, `spendingService.ts`), review settings (`features/settings/ReviewSettings.tsx`), idempotent inbox conversion with Undo, person follow-up dates, direct (non-rule) reminders, planner preferred-date hints, a contrast and focus-ring pass, and the schema bump to SQLite 4 / IndexedDB 5 / export 6 with fixtures. It also fixed twelve of the sixteen UX findings and all four contrast failures from the design critique. It changed no file under docs/ and did not touch CHANGELOG.md.

### 4.1 Fix the browser e2e suite

The specs were not updated with the UI and fail at HEAD:

- tests/e2e/playwright/core-loop.spec.ts:231–243 expects morning `data-step="0"` to be Energy and presses `3`. The flow now starts at the Project question (`MorningFlow.tsx:73`) and the `1/2/3` hotkeys act only when `stepId === 'energy'`. Either answer "No" through the three check-in steps or seed `appSettings.reviews.enabledQuestions = []` in the fixture, then assert the Energy step.
- core-loop.spec.ts:279–287 walks the evening flow with three `Next` presses; the Journal step now sits before the summary. Add one `Next` (or the skip) before `evening-summary`.
- tests/e2e/playwright/bills.spec.ts:13–22 and weekly-review.spec.ts:19–23 fill `getByLabel('Title')` on `/bills`; the form is behind the header "Add bill" toggle (`BillsPage.tsx:86`) and the "Add bill" button name is now ambiguous. Click the toggle first and scope the submit to the form.
- weekly-review.spec.ts:73–74 expects `bills → capacity`; the order is `bills → patterns → capacity`.

### 4.2 Tests for the untested surfaces

- `ReviewDashboard.tsx`: completion badges for the last 14 days, upcoming follow-ups, reflections table with journal links, weekly history. No test references it today.
- `ReviewSettings.tsx`: reorder and enable questions, templates persist to `appSettings.reviews`. No test references it today.
- `MorningCheckIn` "Later today": `scheduleLater` creates a `review-step` reminder whose destination is `/review/morning?date=…&step=…`. Only the persistence half is covered (`dailyReviewService.test.ts`).
- `apps/orbit/src/lib/destinations.ts:120` reminder-destination shortcut has no case in `destinations.test.ts`.
- Rust `scheduler.rs` `take_due`: rows whose `source` is `review-step`, `person-follow-up`, or `monthly-spending` fire without a rule; the existing tests (`scheduler.rs:329–343`) only seed rule rows.
- Rust `data_dir.rs` restore tests loop `[1, 2]` against a v3 live schema (`:655`, `:658`); extend to v3 → v4 and add a `TABLES_V4` assertion to `table_expectations_follow_the_backup_version` (`:641`).

### 4.3 Loose ends

Each is small; fix or record a decision, do not leave it implicit.

1. `reviewService.ts:136` `saveDailyJournal` is dead (superseded by `dailyReviewService.saveDailyReflection`). Delete.
2. `features/today/CompactTimeline.tsx` is orphaned; Today no longer renders it. Delete unless §7.5 re-homes it.
3. `spendingService.ts:176` sets `destination: '/bills?month=YYYY-MM'`; `BillsPage` never reads `?month=`. Read it (scroll/filter to that month) or drop the parameter.
4. `useReminderScheduler.ts:58` opens direct reminders with `window.location.assign()` — a full reload — and drops the Dismiss action for them. Use router navigation and keep Dismiss.
5. `MorningFlow.tsx:718` summary chips render `type · uuid.slice(0, 8)`. Show titles.
6. Currency is hard-coded `'JOD'` in `SpendingPanel.tsx:15`, `PatternsStep.tsx:68`, `spendingService.ts:151`; `trends.ts:181` silently drops non-JOD expenses. Use the bill's currency and group totals per currency; no conversion.
7. Abandoned `DailyReviewDraft` rows and their `review-step` reminders persist forever (cleared only on accept). Clear drafts and reminders for dates before today when the next morning flow starts.
8. `ReviewSettings.tsx:78` says "Desktop · stored locally" but renders on the web. Fix the copy.
9. `AreasPage.tsx:124–130` asks for a second click only for childless areas; areas with goals or projects delete on the first click. Invert (this is also critique UX-016).
10. `--color-ink-faint` `#6c665c` is indistinguishable from `ink-muted` `#6b665d`. §7.2 picks a distinct compliant value.
11. `WEEKLY_REVIEW_FLOW_VERSION` is 2 and never read. Either gate an "a step was added since you started" notice on it or leave a comment that it is informational.

### 4.4 Documentation and changelog

- New docs/DAILY-REVIEWS.md: morning check-in questions and templates, "Later today" reminders, the resumable draft and its expiry (4.3 #7), the evening journal and reflection record, the review dashboard, review settings, and direct reminders (`source ≠ rule`) including the scheduler's liveness rules for them.
- docs/BILLS.md: `kind: 'expense'`, nullable `dueAt`, `dueTime`, the spending panel, the monthly-spending reminder. docs/WEEKLY-REVIEW.md: seven steps, Patterns, the trend report and its fingerprint. docs/PEOPLE-AND-COMMITMENTS.md: follow-up date/time and its reminder. docs/ORBIT-SPEC.md:92: "v1 expense = bill" becomes the expense kind. docs/RESIDENT-BEHAVIOUR.md: the scheduler admits direct sources.
- CHANGELOG.md Unreleased: add the Week 12 work (weekly review, people and commitments, bills and recurrence, notes, `orbit://` links and notification activation, DraftGuard on activation), the d832130 features, a **Fixed** entry for PD-001, and correct line 47 to "export 6 / IndexedDB 5 / SQLite 4".
- Roadmap rows: docs/BACKEND-TASKS.md:825 and docs/FRONTEND-TASKS.md:830 → ✅ COMPLETE (installed-build activation pending); docs/DEVOPS-TASKS.md:693 → ⏸ NOT SELECTED; fix the totals lines. Add a short "Post-Week-12 additions (d832130)" note under each Week 12 section listing the features above.

## 5. Backup rotation, export reminder, diagnostics freshness

### 5.1 Facts that shape the design

- Nothing creates backups today. The only files that reach `<data>/backups` are `before-restore-*.db`, written by `data_restore_backup` (data_dir.rs:449).
- Restore already snapshots the live file with rusqlite's online backup API (`current.backup(MAIN_DB, &preserved, None)`, data_dir.rs:455–457), verifies it, and switches it to `journal_mode=DELETE` with an fsync. The same sequence is duplicated in `relocate_connection` (:233–249).
- WAL mode is set from TypeScript at open (packages/storage/src/sqlite/index.ts:239); Rust re-asserts it only after relocation.
- The only database lock is `Db(Mutex<Database>)` (db.rs:28). `authorize(None)` (db.rs:60–71) reports whether a UI or scheduler transaction owns the connection; `quitting` (db.rs:23) is set during shutdown.
- The scheduler thread (`scheduler.rs:243–274`) is gated per pass by `resident::scheduler_may_run` (resident.rs:594–603) — "the frontend acknowledged this generation and we are not quitting" — and is woken at readiness (`mark_ready`, resident.rs:588). Shutdown joins the thread with a bound (resident.rs:805) and `close_database` waits on the same mutex.
- Existing bug: `data_backups` emits `modified_at` as zero-padded epoch seconds (data_dir.rs:324–326) while `BackupList.tsx:70` slices it as an ISO string. Real backups display as `0000000000001758`. The component test feeds ISO, which is why it passes.

### 5.2 Desktop backup rotation

**Hook.** Call `crate::backup::run_daily(&handle)` in the scheduler thread loop immediately after `tick(&handle)` (scheduler.rs:257). The first pass runs at readiness, which is "first launch of the day" with the database open, integrity checked, and migrations applied. The minute tick also covers a tray-resident process that is never relaunched — close-to-tray is the default, so a launch-only hook could miss weeks. `tick` stays reminder-only; its tests are untouched.

**Due test.** Today is backed up when `backups/daily-<today>.db` exists. A filesystem check, not a preferences stamp: preferences live in the config directory while the data folder is user-chosen and portable; a stamp desyncs after relocation or when a second machine opens the folder; a clock set backwards with a stamp would silently stop backups, whereas an absent file simply triggers one. The date is UTC from `time::now_iso()[..10]` (time.rs is deliberately chrono-free). Record the UTC choice in the doc; the list shows file times.

**Names and rotation.** `daily-YYYY-MM-DD.db`, `weekly-YYYY-MM-DD.db`, `manual-YYYYMMDDTHHMMSSZ.db`; name order is chronological order. After a daily succeeds, promote it by `fs::copy` to `weekly-<today>.db` when no weekly exists or the newest weekly is at least seven days old (needs `days_from_civil`, the inverse of the Hinnant code already in time.rs:16–27, not ISO-week arithmetic). Caps: 7 daily, 4 weekly, 3 manual, 3 before-restore. Before-restore copies get their own cap by modification time and are never touched by the daily/weekly rule; change their prefix to `before-restore-<compact utc>-` so name and time order agree. Unknown `*.db` files are kind `other` and are never deleted. Quarantine files (`orbit.corrupt-*.db`) live in the data root, not in backups/.

**Snapshot.** Extract `pub(crate) fn snapshot_to(source: &Connection, dir: &Path, final_name: &str) -> Result<PathBuf, String>` from the two duplicated sequences: stage into a `tempfile` in the backups directory, online-backup into it, open the copy and `verify_copy`, set `journal_mode=DELETE`, close, fsync, `persist_noclobber` to the final name. A `TempPath` is deleted on drop unless persisted, so every failure path leaves no partial file. Make `verify_copy` `pub(crate)`; relocate and restore switch to the helper.

**Exclusion.** Hold the `Db` mutex for the whole snapshot; this serialises with `data_restore_backup`. Before starting: skip when `quitting`; skip (retry next minute) when `authorize(None)` reports an owned transaction; skip when the connection is not in autocommit. Backups never start unless `scheduler_may_run` is true, so a background launch that never becomes ready does not back up a database that may be mid-migration.

**Command and UI.** `data_backup_now(state, generation: Option<u64>) -> BackupCandidate` mirrors `data_restore_backup`'s `check_generation` and `authorize(None)` and writes `manual-<stamp>.db` (cap 3, so a second click is not a silent no-op). `BackupCandidate` gains `kind: 'daily' | 'weekly' | 'manual' | 'before-restore' | 'other'` and its `modified_at` becomes an ISO instant, fixing the display bug; lexical order stays chronological so `chooseRestore` (sqlite/index.ts:324–328) keeps working. `BackupList.tsx` shows a kind badge, a "Back up now" button with a busy state and toast, and refreshes its query after a manual backup.

**Op-log.** Subsystem `backup`, never a path: `created {kind, weekly, bytes, durationMs}`, `pruned {daily, weekly, manual, beforeRestore}`, `failed {error}` at error level, `skipped {reason}` at debug.

**Files.** New apps/orbit/src-tauri/src/backup.rs (constants `KEEP_DAILY=7`, `KEEP_WEEKLY=4`, `KEEP_MANUAL=3`, `KEEP_BEFORE_RESTORE=3`, `WEEKLY_EVERY_DAYS=7`; `BackupKind` and `classify(file_name)`; pure `plan_prune`; `prune(dir)`; Tauri-free `daily_if_due(db, today) -> Outcome` with `Outcome::{Created{weekly, pruned}, Skipped(Busy | Quitting | Exists | Closed)}`; `run_daily(app)`; `data_backup_now`). commands/data_dir.rs (`snapshot_to`, shared `candidate(path)`, kind and ISO). time.rs (`days_from_civil`, `today_utc`, `date_shift`, `days_between`). scheduler.rs (hook), lib.rs (module and handler). packages/storage/src/sqlite/index.ts (`BackupKind`). apps/orbit/src/platform/types.ts and desktop.ts (`backupNow`). features/settings/BackupList.tsx. Test fakes in apps/orbit/src/test/desktop.ts, SettingsSections.test.tsx, desktop.test.ts. docs/ORBIT-SPEC.md:38 ("rotating dated copies in backups/ — 7 daily + 4 weekly, plus manual copies and a copy before every restore"), docs/RESIDENT-BEHAVIOUR.md (the scheduler thread also takes the daily backup), docs/BACKEND-TASKS.md:777.

**Tests.** Rust: `rotation_keeps_seven_daily_and_four_weekly_and_ignores_other_kinds` (40 daily, 10 weekly, 2 before-restore, `custom.db` → exactly the 7 newest daily and 4 newest weekly remain; the others are untouched); `before_restore_copies_keep_their_own_cap_by_mtime`; `daily_backup_from_a_live_wal_connection_verifies_and_restores` (`wal_autocheckpoint=0` so rows live in the WAL; the copy has no `-wal` sidecar; `verify_copy` passes; `restore_connection` of the copy succeeds and counts match; the live file is still writable); `same_day_is_a_noop_and_weekly_is_promoted_every_seven_days`; `failure_leaves_no_partial_file` (inject failure through a verify hook, as `restore_connection`'s `apply` closure does at data_dir.rs:405); `backup_skips_when_a_transaction_is_owned_or_quitting`; `classify_names`; date-helper round trips. TypeScript: `desktop.test.ts` "backupNow invokes `data_backup_now` with the generation"; `SettingsSections.test.tsx` "kind badges render, Back up now calls the bridge and the new file appears". Desktop e2e `tests/e2e/desktop/backup.e2e.ts` on the cold harness: seed → launch → `shellLog(/^created$/)` with subsystem `backup` → `daily-<today>.db` and a `weekly-*` exist → relaunch the same `sessionDir` → no second `created`.

**Risk to measure.** Snapshot duration at 50k while the mutex is held (UI commands wait). Measure with §6 data; if it exceeds about one second, consider `Backup::step(n)` with pauses, remembering that the mutex, not the API, is the real serialiser.

### 5.3 Web export reminder

**Where the watermark lives.** A device-local `localStorage` entry `orbit-export-watermark` = `{ at, seq }`. Not `appSettings`: it travels with exports and imports (json.ts:72, :100), so a `replace` import would carry the source device's watermark and a foreign `opLogSeq`. Not a new store: one value does not justify a Dexie version and a SQLite migration. `localStorage` already holds the other device-local flags (store.ts:39–54), survives reloads, clears with site data (a fresh install gets the grace period), and is never exported.

**Rules.** On first read, write a baseline `{ at: now, seq: latestSeq }` so "never exported" is not "infinitely overdue" — otherwise 101 operations on day one would nag, and every upgraded install would nag immediately. `exportReminderDue(w, nowMs, latestSeq)` is `days > 7 && latestSeq − w.seq > 100`. A watermark with `seq > latestSeq` (the database was reset) is stale and not due; rewrite the baseline. A JSON export stamps the watermark from the envelope's `exportedAt` and `opLogSeq` (json.ts:118–120, 162–163). The Markdown export does not count; the banner copy says "Export everything as JSON".

**Files.** New features/settings/exportWatermark.ts (`EXPORT_WATERMARK_KEY`, `EXPORT_NAG_DAYS = 7`, `EXPORT_NAG_OPS = 100`, `readExportWatermark`, `writeExportWatermark`, `ensureExportBaseline`, pure `exportReminderDue`, `recordExport`). New features/settings/exportService.ts (`exportJsonToFile(platform, repo, clock)` replacing the duplicated bodies in DataSettings.tsx:31–34 and StorageBanner.tsx:48–50). New components/ExportReminder.tsx: renders only when `!platform.capabilities.dataFolder` (the same runtime test StorageBanner uses), is suppressed while StorageBanner is visible so two banners never stack, offers "Export now" and a session "Dismiss", `role="status"`, `data-testid="export-reminder"`; the query re-evaluates on `dataVersion` (`latestSeq` is O(1) on every adapter). app/store.ts gains `exportReminderDismissed` via `readSessionFlag`/`writeSessionFlag`. components/layout/AppLayout.tsx:26 mounts it after StorageBanner. Pre-existing bug fixed alongside: `platform.exportFile` returns `Promise<boolean>` (platform/{types,web,desktop}.ts) so a cancelled desktop save dialog neither toasts "Export saved" (DataSettings.tsx:42) nor stamps the watermark.

**Tests.** `exportWatermark.test.ts`: fresh install → baseline written, not due; baseline 8 days old + 101 ops → due; 8 days + 100 → not due; 6 days + 500 → not due; after `recordExport({ exportedAt, opLogSeq })` → not due; watermark seq 900 with `latestSeq` 50 → not due and baseline rewritten; corrupt JSON → baseline rewritten. `ExportReminder.test.tsx` (pattern StorageBanner.test.tsx): renders with day and operation counts; Dismiss hides and sets the session flag; Export now calls `platform.exportFile` with `orbit-export-<date>.json`, updates the watermark, hides; never renders when `dataFolder`; suppressed while StorageBanner shows. Optional e2e in `data-safety.spec.ts`: preset the watermark with `addInitScript`, seed > 100 op-log rows through raw IndexedDB (as startup.spec.ts does), assert the banner, click Export now, `waitForEvent('download')`, banner gone after reload.

### 5.4 Diagnostics freshness

`diagnosticsService.ts:88–94` reports the integrity result cached at database open. Run a fresh `PRAGMA integrity_check` when the bundle is built (a Rust command reusing `verify_copy`'s check on the live connection under the same lock rules as 5.2) and record its result and duration in `report.json`. Keep the PII tests (`bundle_holds_the_report_marker_and_logs_and_nothing_a_person_wrote`, `DiagnosticsSettings.test.tsx`) green and tick the diagnostics deliverable at docs/BACKEND-TASKS.md:797.

## 6. Performance at 50k

- **Browser startup.** `tests/e2e/playwright/startup.spec.ts` `SIZES` (:12) gains 50 000 tasks / 10 000 notes. Keep 5k in `pnpm e2e`; run 50k only in the `.github/workflows/bench.yml` `startup` job through `e2e:startup`. The budget stays 1 500 ms local / 3 000 ms CI to the `orbit:interactive` mark.
- **Desktop startup.** New `tests/e2e/desktop/startup-50k.e2e.ts`: extend `tests/e2e/desktop/seedDb.ts` with `seedLarge(n)` over the production SQLite adapter, launch through `coldLaunch.ts`, assert `spawnToMainPageMs` plus the interactive mark under 1 500 ms (3 000 ms CI). Add it to the cold job in data-safety.yml or to bench.yml.
- **Adapter bench.** New `bench/adapters.bench.ts` registered in `scripts/bench.ts` with budgets in `bench/baseline.json`: SQLite via `betterSqliteDriver`, IndexedDB via `fake-indexeddb`; list open tasks, search query (FTS5 and MiniSearch), weekly-review snapshot load, action-receipt lookup, note save and preview, all at 50k/10k. This closes the Week 12 §14 page-level carry-over.
- **WebKit stall.** `startup.spec.ts` fails deterministically in WebKit after seeding (FIXES.md TI-006). Timebox two hours to profile: IndexedDB read path versus a Playwright-WebKit-on-Windows artifact. The outcome is either a classified defect with an issue, or "harness artifact; WebKit excluded from the startup spec with a comment". It is not left as an unclassified failure.
- **Backup cost.** Measure 5.2's snapshot duration on the 50k file and record it beside the startup numbers.

## 7. Accessibility, contrast, motion, narrow desktop, critique leftovers

### 7.1 Automated accessibility

Add `@axe-core/playwright`. New `tests/e2e/playwright/a11y.spec.ts` seeds data and visits `/today`, `/inbox`, `/timeline`, `/areas`, `/goals`, `/projects`, `/projects/:id`, `/people`, `/people/:id`, `/bills`, `/bills/:id`, `/notes`, `/notes/:id`, `/review`, `/review/morning`, `/review/evening`, `/review/weekly`, `/insights`, `/search`, `/settings`, `/tasks/:id`, asserting zero serious or critical violations per route. Runs inside `pnpm e2e`. Fix what it finds before widening rules.

### 7.2 Contrast

New `scripts/contrast.ts` (or a Vitest under apps/orbit/src/styles/) parses `tokens.css` and asserts WCAG ratios for the pairs the code actually uses: ink / ink-muted / ink-faint on surface 1–3; nav-fg / nav-muted on nav; lime-ink on lime; gold-ink on gold-2; danger on danger-soft; ok on surface. Fix the warnings the critique left open: `ok` `#3d8f5a` (3.54:1, darken for text use), `nav-muted/70` kbd hints (3.21:1 at 11 px; raise size or opacity), and restore an `ink-faint` distinct from `ink-muted` at ≥ 4.5:1 (4.3 #10). Audit how much UI sits at 11–12 px and raise the floor where it carries information.

### 7.3 Motion

Test that `:root[data-motion='reduced']` and `prefers-reduced-motion: reduce` disable transitions (attribute/class assertion, the roadmap's "class assertion"). `slide-in-right` 200 ms → 180 ms to sit inside the 120–180 ms band. Gate the two `motion`-library animations on the in-app toggle, not only the OS query.

### 7.4 Narrow desktop

The rail collapses to icons under `md` (768 px, AppLayout.tsx:17); Today and the timeline go single-column under 900 px (TodayPage.tsx:175, `NARROW_QUERY`). The desktop window's `minWidth` of 900 (tauri.conf.json:20) makes both stages unreachable in the shell. Lower `minWidth` to 720 and `minHeight` to 560, keep the two-stage behaviour, and add component tests: "rail expanded at ≥ 768, icon-only below" and "Today single column below 900". Verify dialogs, the capture window, and Settings at 720 px.

### 7.5 Critique leftovers (verified still open at HEAD)

- UX-006/007 Today "one column of truth": d832130 dropped `CompactTimeline` and went two-column; finish by giving the panels honest titles, removing the duplicate list, and stopping the three-line header wrap.
- VH-001: anchor the two page-level CTAs ("Start morning briefing", "Weekly review") to the hero.
- VH-002: reserve lime for action; audit the remaining uses.
- UX-011: Goals empty state when areas exist but no goals do.
- UX-016: areas delete confirmation (4.3 #9).
- CN-001: one human date format everywhere; ISO only inside `<time datetime>`.
- CN-002: two page widths, not four.
- CN-003: one create pattern (inline one-liner plus "more fields") for Areas, Goals, Notes, People, Projects, Bills.
- CN-004: decide auto-save versus explicit save per screen and document it; no rewrite.
- CN-006: shared `EmptyState` everywhere; rewrite the Insights empty copy in user terms.
- CN-007: fold the gold pill into the `gold` button variant.
- Icon buttons at 28 px → 32 px minimum.
- `AppearanceSettings.tsx:21–24`: remove "A dark workspace arrives with the visual polish in week 13".

### 7.6 Manual passes → docs/A11Y-AUDIT.md

Keyboard-only walk of every route on desktop (WebView2) and in Chromium; NVDA on WebView2 for Today, Inbox, the morning/evening/weekly flows, and Settings; 200 % and 400 % zoom reflow. VoiceOver is recorded NOT RUN (no Apple hardware). One table per route: PASS / FAIL / NOT RUN, the fix commit, and what remains.

## 8. Security review

### 8.1 Finding: app commands are not gated today

Tauri 2.11.5 skips the ACL for non-`plugin:` commands from a local origin unless the application declares its own manifest, and `apps/orbit/src-tauri/build.rs` is the bare `tauri_build::build()`. The capture window loads the same SPA at `/capture` (tauri.conf.json:24–36) and can therefore invoke every command in lib.rs:192–230 — `data_restore_backup`, `file_write_text`, `resident_quit` included. `capabilities/default.json` also grants `notification:default` and `autostart:default`, which nothing in the WebView uses (autostart is Rust-only; `platform.notify` is unreachable on desktop, useReminderScheduler.ts:40–44), and five `core:window:allow-*` permissions that no code calls.

### 8.2 Capabilities per window and the app-command ACL

- `build.rs` → `tauri_build::try_build(Attributes::new().app_manifest(AppManifest::new().commands(&[…every command name…])))`. This generates `permissions/autogenerated/{allow,deny}-<kebab>.toml` and turns on ACL checks for app commands. Add `apps/orbit/src-tauri/permissions/autogenerated/` to .gitignore beside `gen/`. Keep `generate_handler!` and the manifest list in sync through a shared `const` in `commands/list.rs` (or a unit test that diffs them).
- Delete `capabilities/default.json`. New `capabilities/main.json` (windows `["main"]`): `core:path:allow-join`, `core:event:allow-listen`, `core:event:allow-unlisten`, `dialog:allow-open`, `dialog:allow-save`, `opener:allow-default-urls`, and `allow-<kebab>` for every main-window command, including `allow-data-backup-now`, `allow-resident-quit`, and the test-only `allow-resident-activation-pending` (documented as such). New `capabilities/capture.json` (windows `["capture"]`): `core:path:allow-join`, `core:event:allow-listen`, `core:event:allow-unlisten`, `core:window:allow-start-dragging`, and only `db_open/close/execute/select/exec/begin/finish`, `data_dir_get/set/default`, `data_backups`, `data_quarantine`, `data_restore` (needed for recovery when a `--capture` launch opens the file first — or refuse by `window.label()` in Rust; decide and record), `capture_hide/show`, `diagnostics_last_run/log`, `resident_capture_subscribed`, `resident_quit_ack`, `scheduler_wake`. Every plugin/core call site is in platform/desktop.ts:49–74, ResidentBridge.tsx:170, QuickCaptureWindow.tsx:39 and :92, NotePreview.tsx:33.
- Test `tests/e2e/tauri/specs/capabilities.spec.ts` (the WDIO harness already switches windows, transactions.spec.ts:58): from capture, `invoke('data_restore_backup')`, `invoke('file_write_text')`, `invoke('resident_quit')`, and `invoke('plugin:dialog|open')` reject with "not allowed by ACL", while `invoke('db_select', …)` succeeds; from main, `invoke('capture_hide')` and `invoke('plugin:window|start_dragging')` reject.
- The manifest is all-or-nothing: a command missing from a window's list fails at runtime. Both desktop harnesses (`e2e:desktop`, `e2e:desktop:cold`) must be green before merging; core-loop (capture → inbox) is the canary.

### 8.3 Content-security policy

- Desktop delivers CSP as a response header on `tauri.localhost`. A `<meta>` policy in dist/index.html would be enforced in addition on desktop, so the web meta is skipped for Tauri builds.
- Keep `style-src 'unsafe-inline'`: Radix modal Dialog/Popover/Select mount `react-remove-scroll` → `react-style-singleton`, which appends a `<style>` element and accepts a nonce only via `__webpack_nonce__`; Tauri does not expose its nonce to page JS. React `style={{}}` props (11 sites) go through the CSSOM and are not the blocker. Tighten everything else in tauri.conf.json:37: `default-src 'self' ipc: http://ipc.localhost; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; media-src 'none'`. `__TAURI_INTERNALS__` is injected through `AddScriptToExecuteOnDocumentCreated`, not a `<script>` tag, and dist/index.html has no inline elements, so `script-src 'self'` is safe.
- Web: a build-only Vite plugin in apps/orbit/vite.config.ts (`apply: 'build'`, `transformIndexHtml` injecting `<meta http-equiv="Content-Security-Policy">` at `head-prepend`, skipped when `process.env.TAURI_ENV_PLATFORM` is set) with `WEB_CSP = default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'`. No static meta in index.html: `vite dev` injects the React refresh preamble inline. The service worker (`registerType: 'prompt'`, bundled `virtual:pwa-register/react`) and the bundled Inter font are compatible. docs/HOSTING.md's Caddyfile gains the header plus `frame-ancestors 'none'` (ignored in meta by specification). lighthouserc.json:19 turns `csp-xss` to `warn` with a pinned `maxLength`; it is an informative audit, so confirm N on the first run.
- Proof. `tests/e2e/desktop/csp.e2e.ts` on the cold harness (`tauri dev` gets no CSP): collect console lines matching `/Content Security Policy/` and `securitypolicyviolation` events while opening the Restore dialog, the command palette, the Timeline, and a Notes preview; assert both lists empty; assert the `content-security-policy` header on `http://tauri.localhost/index.html` equals the config. `tests/e2e/playwright/csp.spec.ts`: the exact meta is present; the same walk on chromium, firefox, and webkit produces zero violations; the service worker registers and `offlineReady` appears.

### 8.4 Dependency audit in CI

- New `audit` job in `.github/workflows/ci.yml`: `pnpm audit --prod --audit-level=high` blocking (confirm the five Q-002 `@wdio/*`/`mocha` root-dev advisories vanish under `--prod`; if not, `--ignore` them with the Q-002 reference from FIXES.md); the full `pnpm audit --json` and `pnpm licenses list --prod --json` as non-blocking reports into the step summary; `cargo audit -f apps/orbit/src-tauri/Cargo.lock`; `cargo deny --manifest-path apps/orbit/src-tauri/Cargo.toml check`. Tools through `taiki-e/install-action` (verify the input names) — neither needs the placeholder dist/ the `rust` job builds. Upload an `audit-reports` artifact. Run the job on the nightly cron as well, because advisories appear without code changes.
- New `apps/orbit/src-tauri/deny.toml`: `[graph] targets = ["x86_64-pc-windows-msvc"]` (what ships; this drops tauri's mobile-only `reqwest`/`hyper`); `[advisories] yanked = "deny"`, `ignore = []` (every future entry needs a reason and a link); `[licenses]` allowlist MIT, Apache-2.0, Apache-2.0 WITH LLVM-exception, BSD-2-Clause, BSD-3-Clause, ISC, Zlib, 0BSD, Unicode-3.0, Unicode-DFS-2016, CC0-1.0, MIT-0, BSL-1.0, with an MPL-2.0 exception for `option-ext` — confirm the set on the first `cargo deny check licenses`; `[bans] deny = [reqwest, hyper, ureq, curl, openssl, native-tls, rustls, ring]` as a machine-checked "no HTTP or TLS client is compiled for Windows"; `[sources] unknown-registry = "deny"`, `unknown-git = "deny"` (all 465 crates come from crates.io).

### 8.5 Zero-network proof

- Web. New `tests/e2e/playwright/fixtures.ts` exporting `test`/`expect` with two auto fixtures: one records `context.on('request')` for every test, attaches `network-requests.json`, and fails on any URL outside the dev-server origin (replacing the ad-hoc list in notes.spec.ts:13–14, 51–52); the other collects CSP violations from the console and a `securitypolicyviolation` listener. Switch the nine specs to `./fixtures`. Set `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1` in `.github/workflows/e2e.yml` (service-worker fetches are visible on Chromium only; document that). New `tests/e2e/playwright/zero-network.spec.ts` walks every route in routes.tsx:64–108, creates records, exports, reloads with the service worker active, then `context.setOffline(true)` and reloads again — the precache proves offline operation.
- Desktop. New `tests/e2e/desktop/zero-network.e2e.ts` on the cold harness: `newCDPSession` + `Network.enable` on the main and capture pages; drive capture → inbox → project → settings → export → "Back up now" → Restore dialog → tray quit; assert every request origin is `http://tauri.localhost` or `http://ipc.localhost`; write `network-desktop.json`. Attachment happens after first paint, so the initial index.html and asset loads are not captured — same-origin by construction; say so. Once per release, OS-level evidence from `scripts/net-watch.ps1`: poll `Get-NetTCPConnection` and `Get-NetUDPEndpoint` for `orbit.exe` and its `msedgewebview2.exe` children through a full session, attributing any WebView2 runtime update traffic by process.
- Evidence under docs/testing/release-1.0/: `REPORT.md`, `zero-network.md` (method, allowlist, request counts per browser and per window, OS watch output, caveats), `dependency-audit.md` (pnpm prod and full, cargo audit, cargo deny, the Q-002 acceptance), and the raw `network-web-{chromium,firefox,webkit}.json`, `network-desktop.json`, `pnpm-audit.json`, `cargo-audit.json` copied from the CI artifacts.

### 8.6 SECURITY.md and PRIVACY.md

docs/SECURITY.md: threat model (single user, no accounts, no server); data at rest (no encryption by decision; rely on OS disk encryption; exports, `backups/`, and logs are plaintext; logs are redacted per logging.rs); desktop isolation (capability tables per window, the app-command ACL from build.rs, no fs/shell/http plugins, paths only from native dialogs, what `file_read_text`/`file_write_text` accept); both CSPs verbatim and why `'unsafe-inline'` remains on `style-src`; network (none; `reqwest` is a mobile-only tauri dependency not compiled for Windows; the opener is a user-initiated OS hand-off; the CI proof job); dependency policy (deny.toml, Q-002 accepted advisories with the "no patched version" note); release signing status (unsigned NSIS for 1.0.0 and the SmartScreen consequence); how to report. docs/PRIVACY.md: no network, no telemetry, the files Orbit writes and where, what the diagnostics bundle contains and never contains, the updater not selected. Link both from README.md and from docs/RELEASE.md "Before tagging".

## 9. Installed-build verification (Sandbox and host account)

### 9.1 Environment

Windows Sandbox (`Containers-DisposableClientVM`) is enabled on the developer machine and becomes usable after the pending reboot. Every session is a pristine Windows profile that is discarded on close — exactly the "clean machine" the verification record demands. It cannot reboot or sleep; those three scenarios run under a throwaway local account (`OrbitTest`) on the host, where the NSIS `currentUser` install (`%LOCALAPPDATA%\Programs\Orbit`, `HKCU` protocol and Run keys) is isolated from the developer profile. Hyper-V is not needed.

The `.wsb` file is opened by the user from Explorer, and `tauri build` runs from the user's terminal (3.1: never from inside the Claude desktop app).

### 9.2 Harness — new folder tests/installed/

- `orbit-sandbox.wsb`: maps `apps/orbit/src-tauri/target/release/bundle/nsis` and `tests/installed` read-only; `LogonCommand` runs `bootstrap.ps1`.
- `bootstrap.ps1`: confirms the WebView2 runtime (Sandbox ships Edge; install the Evergreen bootstrapper when the `EdgeUpdate\Clients\{F3017226-…}` key is absent); copies the requested installer(s) locally; installs candidate A with `/S`; seeds the disposable dataset (a pre-built `orbit.db` from `tests/campaign/desktop/seedDb.ts` copied into `%APPDATA%\app.orbit.desktop\data`, or a small Node bundle); opens `CHECKLIST.md`.
- `checks.ps1`: the automatable assertions — `HKCU\Software\Classes\orbit\shell\open\command` value and quoting; the `Run\Orbit` value; the foreign-handler pre-seed (`orbit` class pointing at `notepad.exe` before install → the installer leaves it and the app reports a missing handler); protocol dispatch through the real registered handler with `Start-Process 'orbit://task/<id>'` while Orbit is visible, hidden, and exited; a duplicate manual launch against the real single instance; `Stop-Process -Force` then relaunch → exactly one unclean-run report; upgrade A → B with `/S` over the top keeping the handler, the executable target, and the login-launch opt-in; `uninstall.exe /S` removing only Orbit's keys while data and backups remain; immediate display failure (Orbit's notifications disabled in Windows Settings → a due reminder leaves a retryable pending row); Focus Assist on and off; the installed Orbit name and icon on the toast.
- `CHECKLIST.md`: the eleven scenarios from docs/RESIDENT-BEHAVIOUR.md:252–266 with PASS / FAIL / NOT RUN, the evidence expected for each (screenshot, registry export, `last-run.json`, op-log lines), and the two builds used with their sha256 from tests/campaign/snapshot.ts.
- Candidates: A = the current `Orbit_0.1.0-alpha.2_x64-setup.exe`; B = the Week 13 candidate built after §8 (the capability and CSP changes must be in the build under test).

### 9.3 Host account scenarios

Under `OrbitTest` (deleted afterwards): install → enable login launch → reboot → hidden initialisation → reminder delivery; disable → reboot → no auto-launch; sleep/resume across a due time without duplicate delivery. Manual, recorded with the same evidence discipline.

### 9.4 Records and follow-ups

Update the verification record in docs/RESIDENT-BEHAVIOUR.md, docs/DEEP-LINKS.md:102–106, docs/DEVOPS-TASKS.md, and the Week 12 section headers. Flip "(installed-build activation pending)" only for scenarios that passed. Test explicitly the hooks.nsh subtlety: the install-time ownership check is the loose substring `orbit.exe` while uninstall uses `$INSTDIR\orbit.exe`; if a second install in a different folder overwrites a foreign-path handler, tighten the install check to the full path.

### 9.5 MSI

Remove `"msi"` from `bundle.targets` in tauri.conf.json:46. docs/RELEASE.md records MSI as a post-1.0 channel behind its own cleanup gate (§15).

## 10. Release 1.0.0

- `scripts/bump-version.ts` → 1.0.0 across tauri.conf.json, apps/orbit/package.json, the root package.json, and Cargo.toml.
- CHANGELOG.md: cut `[1.0.0] — <date>` from Unreleased (git-cliff plus the hand edits from 4.4).
- docs/RELEASE.md: the channel table gains `v1.0.0` (NSIS-only, unsigned by decision, `SHA256SUMS.txt`, PWA zip); steps 12–13 point at the Sandbox harness; MSI and signing appear as decisions, not omissions.
- README.md: status → 1.0 plus a docs index linking every feature doc (a README section or docs/README.md); refresh SETUP.md.
- Full gate on the release commit from an idle machine in the user's context: `pnpm test`, `pnpm e2e` (Chromium and Firefox; WebKit with §6's classification), `pnpm e2e:desktop`, `pnpm e2e:desktop:cold`, the data-safety workflow, `pnpm bench`, the a11y spec, the audit job, the contrast checker, the zero-network fixtures.
- Tag `v1.0.0`. release.yml builds the NSIS installer, the PWA zip, and checksums as a draft. Install the draft artifact in Sandbox (docs/RELEASE.md steps 12–13 plus `checks.ps1` as a smoke), then publish.
- Phase I campaign rerun (REPORT.md §4): run the campaign stages with tests/campaign/run-stage.ts against the release binary; results and snapshot under docs/testing/release-1.0/.

## 11. Day-by-day execution schedule

### Day 1 — Baseline and the stale suite

- Snapshot the tree and record the existing gate results.
- Fix the four stale browser specs (4.1); delete out.txt and err.txt.
- Correct the three roadmap rows; catch CHANGELOG.md up to Week 12 and d832130.

Exit: `pnpm e2e` green; the changelog and roadmaps describe the code that exists.

### Day 2 — d832130 loose ends, tests, and docs

- Loose ends 1–11 (4.3).
- Tests for ReviewDashboard, ReviewSettings, "Later today", the destinations shortcut, `take_due` direct sources, and restore v3 → v4 (4.2).
- docs/DAILY-REVIEWS.md and the BILLS / WEEKLY-REVIEW / PEOPLE / ORBIT-SPEC / RESIDENT-BEHAVIOUR updates (4.4).

Exit: every new screen has a doc and a test; no dead or orphaned code from the commit remains.

### Day 3 — Backup rotation core

- backup.rs, `snapshot_to`, time helpers, the scheduler hook, the command.
- The Rust tests in 5.2.

Exit: rotation keeps exactly 7 + 4; a live WAL backup verifies and restores; failure leaves no partial file.

### Day 4 — Backup UI, export reminder, diagnostics

- "Back up now", kind badges, the ISO fix, bridge and fakes; the desktop backup e2e.
- exportWatermark, exportService, ExportReminder, the `exportFile` boolean; their tests.
- Fresh integrity check in the diagnostics bundle.

Exit: 5.2–5.4 tests green on web and desktop.

### Day 5 — Performance at 50k

- 50k in the browser startup spec (bench job); the desktop 50k startup spec; the adapter bench with budgets.
- WebKit stall timebox and classification; backup cost measured.

Exit: budgets asserted; numbers recorded in docs/testing/release-1.0/.

### Day 6 — Automated accessibility

- `@axe-core/playwright`, the route sweep, and fixes for every serious/critical violation.

Exit: a11y spec green on every route.

### Day 7 — Contrast, motion, narrow desktop, manual passes

- Contrast checker and token fixes (7.2); the reduced-motion test and gating (7.3); breakpoints and `minWidth` 720 (7.4).
- Keyboard and NVDA passes; zoom reflow; docs/A11Y-AUDIT.md.

Exit: contrast checker green; A11Y-AUDIT.md complete with VoiceOver marked NOT RUN.

### Day 8 — Critique leftovers

- Today one-column-of-truth, CTAs, lime policy, empty states, date format, page widths, create pattern, save semantics decision, gold variant, icon sizes, the Appearance copy (7.5).

Exit: the critique's open list is closed or explicitly deferred with a reason.

### Day 9 — App-command ACL and CSP

- build.rs manifest, `commands/list.rs`, main.json and capture.json, .gitignore; the capabilities spec.
- Desktop CSP header; the web build-time meta plugin; HOSTING.md and lighthouserc; the two CSP specs.

Exit: both desktop harnesses green under the ACL; zero CSP violations on both runtimes.

### Day 10 — Audit CI, zero-network, security docs

- The `audit` job and deny.toml; the first `cargo deny` licence run reconciled.
- fixtures.ts and the zero-network specs (web and desktop); net-watch.ps1.
- docs/SECURITY.md and docs/PRIVACY.md.

Exit: audit job green; every existing e2e is also a zero-network assertion; the docs exist and are linked.

### Day 11 — Sandbox (after the reboot)

- tests/installed/ harness; build candidate B from the user's terminal.
- Run the eight Sandbox scenarios against A and B; collect evidence.

Exit: eight rows in CHECKLIST.md filled with PASS/FAIL and evidence.

### Day 12 — Host account and records

- `OrbitTest`: the three reboot/sleep scenarios.
- Update RESIDENT-BEHAVIOUR.md, DEEP-LINKS.md, DEVOPS-TASKS.md, Week 12 headers; hooks.nsh fix if 9.4 requires it; remove the MSI target.

Exit: all eleven scenarios recorded; "pending" wording flipped only where evidence exists.

### Day 13 — Release preparation

- Version 1.0.0, changelog cut, RELEASE.md, README/SETUP/docs index.
- The full regression gate on the release commit.

Exit: every gate green on the commit that will be tagged.

### Day 14 — Tag, smoke, publish

- Tag v1.0.0; the draft release; the Sandbox smoke of the built artifact; publish.
- Phase I campaign rerun recorded.

Exit: v1.0.0 public; docs/testing/release-1.0/REPORT.md complete.

### Days 15–16 — Contingency

Windows verification surprises, axe fallout, CSP surprises from a library that injects styles, and the ACL command list. Use them before declaring anything NOT RUN that could have been run.

## 12. Verification commands and evidence

Run implementation-time commands from C:\Orbit. These are planned gates, not tests already performed.

### Focused test loops

```powershell
cargo test --manifest-path apps/orbit/src-tauri/Cargo.toml backup data_dir scheduler
pnpm exec vitest run --project orbit exportWatermark ExportReminder BackupList ReviewDashboard ReviewSettings MorningCheckIn destinations
pnpm exec vitest run --project storage migrations
pnpm exec playwright test tests/e2e/playwright/a11y.spec.ts tests/e2e/playwright/csp.spec.ts tests/e2e/playwright/zero-network.spec.ts
pnpm exec vitest run --config tests/e2e/desktop/vitest.config.ts backup csp zero-network startup-50k
pnpm exec tsx scripts/contrast.ts
```

Confirm nonzero relevant tests ran; an empty filter is not a pass.

### Full regression gate

```powershell
pnpm lint
pnpm type-check
pnpm test:coverage
pnpm format:check
pnpm build
pnpm check:bundle
pnpm e2e
pnpm e2e:desktop
pnpm e2e:desktop:cold
pnpm bench
pnpm audit --prod --audit-level=high
cargo audit -f apps/orbit/src-tauri/Cargo.lock
cargo deny --manifest-path apps/orbit/src-tauri/Cargo.toml check
```

### Performance and responsiveness

- Browser startup at 5k in `pnpm e2e`; at 50k in the bench workflow. Budget 1 500 ms local / 3 000 ms CI to `orbit:interactive`.
- Desktop startup at 50k through the cold harness; same budget.
- Adapter bench budgets in bench/baseline.json; backup snapshot duration recorded.

### Installed Windows

Sandbox: open tests/installed/orbit-sandbox.wsb from Explorer; follow CHECKLIST.md; run checks.ps1 inside the sandbox; export evidence to the mapped folder before closing. Host account: the three scenarios in 9.3. Mark PASS, FAIL, or NOT RUN per scenario. A missing environment is a verification dependency, not permission to claim the gate passed.

### Report format

For every required gate, record PASS, FAIL, or NOT RUN with:

- commit, build hash, and environment;
- command or exact manual steps;
- observed versus expected outcome;
- artifact, screenshot, or log location without personal content;
- known limitations and owner of remaining verification.

Evidence lives under docs/testing/release-1.0/ with the header format of docs/testing/campaign-2026-09-15/REPORT.md (date, HEAD, tree digest, binary hash).

## 13. Planned files and reviewable checkpoints

### Native

- apps/orbit/src-tauri/src/backup.rs (new); commands/data_dir.rs (`snapshot_to`, candidate kinds, ISO `modified_at`); time.rs (date helpers); scheduler.rs (hook); lib.rs (module, handler).
- apps/orbit/src-tauri/src/commands/list.rs (new, shared command list); build.rs (app manifest); capabilities/main.json and capture.json (new; default.json removed); deny.toml (new); tauri.conf.json (CSP, `minWidth`/`minHeight`, targets without msi).
- Rust tests for rotation, snapshot, exclusion, the direct-source scheduler branch, restore v3 → v4, and a fresh integrity check.

### Frontend

- features/settings/exportWatermark.ts, exportService.ts, components/ExportReminder.tsx (new); BackupList.tsx, DataSettings.tsx, StorageBanner.tsx, app/store.ts, platform/{types,web,desktop}.ts, components/layout/AppLayout.tsx.
- vite.config.ts (`orbit-csp-meta` plugin); styles/tokens.css (contrast fixes); AppearanceSettings.tsx (copy); AppLayout.tsx and TodayPage.tsx (breakpoint tests); the 4.3 loose-end files; the 7.5 screens.
- Tests for ReviewDashboard, ReviewSettings, MorningCheckIn "Later today", destinations, ExportReminder, exportWatermark, BackupList, reduced motion, breakpoints.

### Tests and tooling

- tests/e2e/playwright/fixtures.ts, a11y.spec.ts, csp.spec.ts, zero-network.spec.ts (new); the four repaired specs; startup.spec.ts sizes.
- tests/e2e/desktop/backup.e2e.ts, csp.e2e.ts, zero-network.e2e.ts, startup-50k.e2e.ts (new); seedDb.ts `seedLarge`.
- tests/e2e/tauri/specs/capabilities.spec.ts (new).
- bench/adapters.bench.ts (new); scripts/bench.ts registration; bench/baseline.json.
- scripts/contrast.ts, scripts/net-watch.ps1 (new).
- tests/installed/orbit-sandbox.wsb, bootstrap.ps1, checks.ps1, CHECKLIST.md (new).
- .github/workflows/ci.yml (`audit` job), bench.yml (50k startup), e2e.yml (service-worker network env, evidence upload).

### Documentation

- docs/WEEK-13-PLAN.md (this plan); docs/DAILY-REVIEWS.md, docs/A11Y-AUDIT.md, docs/SECURITY.md, docs/PRIVACY.md (new).
- docs/BILLS.md, docs/WEEKLY-REVIEW.md, docs/PEOPLE-AND-COMMITMENTS.md, docs/ORBIT-SPEC.md, docs/RESIDENT-BEHAVIOUR.md, docs/DEEP-LINKS.md, docs/HOSTING.md, docs/RELEASE.md, docs/BACKEND-TASKS.md, docs/FRONTEND-TASKS.md, docs/DEVOPS-TASKS.md, README.md, SETUP.md, CHANGELOG.md.
- docs/testing/release-1.0/ (REPORT.md, zero-network.md, dependency-audit.md, Sandbox evidence, bench numbers, campaign rerun).

### Reviewable checkpoints

1. Baseline green (Day 1–2): the stale suite repaired, new screens tested and documented, changelog and roadmaps true.
2. Data safety (Day 3–4): rotation, manual backup, export reminder, diagnostics freshness.
3. Performance (Day 5): 50k budgets and adapter numbers.
4. Accessibility and polish (Day 6–8): axe, contrast, motion, narrow desktop, critique closure, A11Y-AUDIT.md.
5. Security (Day 9–10): ACL, CSP, audit job, zero-network proof, SECURITY.md and PRIVACY.md.
6. Installed Windows (Day 11–12): Sandbox and host-account records.
7. Release (Day 13–14): v1.0.0 published with evidence.

## 14. Definition of done

### Code and data

- [ ] Browser, desktop, cold, data-safety, bench, a11y, audit, and zero-network gates green on the release commit.
- [ ] Backups rotate 7 daily + 4 weekly (+ 3 manual, + 3 before-restore); every kind restores; the list shows real dates.
- [ ] The web reminds after 7 days and 100 operations, stops after a JSON export, and never nags a fresh install.
- [ ] The diagnostics bundle carries a fresh integrity result and still no content.
- [ ] 50k startup within budget on both runtimes with recorded numbers; adapter and page-level measurements exist.
- [ ] The WebKit startup stall is classified.

### Interface

- [ ] axe reports zero serious/critical violations on every route.
- [ ] Every used token pair passes the contrast checker; `ink-faint` and `ink-muted` are distinct.
- [ ] Reduced motion is asserted by test and honoured by the motion library.
- [ ] The rail collapses under 768 px and Today is single-column under 900 px inside the desktop shell.
- [ ] The critique's open findings are closed or deferred with a reason; the Appearance copy no longer promises a dark theme.
- [ ] docs/A11Y-AUDIT.md records keyboard, NVDA, and zoom results; VoiceOver NOT RUN.

### Security

- [ ] App commands are gated per window; the capture window cannot invoke restore, file writes, or quit.
- [ ] Capabilities are minimal and documented; no dead grants.
- [ ] CSP is enforced on both runtimes with zero violations in the proof specs.
- [ ] The audit job is green; deny.toml asserts no HTTP/TLS client is compiled for Windows.
- [ ] Every browser e2e is a zero-network assertion; the desktop CDP and OS-level evidence exists.
- [ ] docs/SECURITY.md and docs/PRIVACY.md exist, state the encryption decision, and are linked.

### Installed desktop

- [ ] The eleven scenarios are recorded PASS/FAIL/NOT RUN from a real Sandbox session and the host account, with evidence.
- [ ] "(installed-build activation pending)" is flipped only where the scenario passed.
- [ ] MSI is out of the stable targets and recorded as a post-1.0 channel.

### Release and handoff

- [ ] v1.0.0 published: NSIS installer, PWA zip, SHA256SUMS; unsigned by decision.
- [ ] CHANGELOG.md, README.md, SETUP.md, docs/RELEASE.md, and the docs index are current.
- [ ] The Phase I campaign rerun is recorded under docs/testing/release-1.0/.
- [ ] Roadmap checkboxes distinguish implemented, verified, pending, and deferred.
- [ ] No mobile, dark-theme, MSI, signing, encryption, or updater scope was silently added.

## 15. After launch (1.1 and later)

Recorded here so the deferrals are decisions, not omissions.

1. **Mobile PWA layouts** (roadmap Week 13, frontend task 1): bottom navigation (Today, Inbox, Capture, Reviews, More), a capture-first phone home, safe areas, touch targets ≥ 44 px; Playwright mobile projects (Pixel/Chromium, iPhone/WebKit); a real-device pass over LAN. The pieces already in place: `viewport-fit=cover`, `h-dvh`, `NARROW_QUERY`.
2. **Dark theme**: a dark token set, `[data-theme]` with a system-preference default, and the contrast checker run against both themes.
3. **MSI channel**: WiX cleanup fragments equivalent to hooks.nsh, verified in Sandbox, then re-added to the stable targets.
4. **Optional updater**: still not selected; its gates are in docs/WEEK-12-PLAN.md §12.
5. **Password-protected exports**, if ever wanted: the only encryption option that leaves the database and the restore path untouched.
6. **Coverage debt**: `TaskPage.tsx`, `DiagnosticsBridge.tsx`, `InsightsProvider.tsx` at 0 %; thin branches in `weeklyService.ts`, `structureService.ts`, `ProjectPage.tsx`, `TaskEditor.tsx`.
7. **Campaign rows that stay NOT RUN after 1.0**: Edge, Android Chrome, and iOS Safari browsers; 8-hour endurance runs; 20+ cold-start samples on a pinned reference machine; the Q-002 advisories re-checked when `@wdio`/`mocha` ship fixes.
8. **Form-pattern and copy consistency debt**: CN-001's single human-date formatter, CN-003's
   shared progressive create form, and CN-004's screen-by-screen autosave decision require a
   product migration rather than release-hardening edits. They remain visible follow-up work;
   1.0 keeps the existing formats and save contracts. CN-002 is closed in Week 13 by standardising
   ordinary pages on `max-w-3xl` and wide dashboards/workspaces on `max-w-6xl`.
9. **Visual-system consistency debt**: VH-002's complete semantic lime migration and CN-006's
   conversion of every specialized empty message to the shared component are deferred. Week 13
   fixes the audited contrast and touched high-traffic paths without relabelling established task
   category colors or rewriting contextual flow/editor messages immediately before release.

## 16. Final recommendation

Absorb d832130 first and completely: a plan measured against a red suite and undocumented screens proves nothing. Then take the two code-heavy packages — backup rotation and the app-command ACL — early, because each can surface a design constraint (lock contention at 50k, a command the capture window turns out to need) that is cheaper to learn on Day 3 than on Day 13.

Treat the installed Windows pass as the release gate it has been called since Week 11. The environment now exists; the plan fails honestly if the harness is written but the scenarios are not run. Ship 1.0.0 unsigned, NSIS-only, with every deferral written down in §15, rather than delaying for scope that was never selected.
