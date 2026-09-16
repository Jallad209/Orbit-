# Orbit — fixes applied for the campaign findings

Follow-up to the historical baseline in `FINDINGS.md` and `REPORT.md`. The original application
and harness fixes are commits `573c36f` through `26771f1`; the report commit `98bcb50` remains
local to `main` unless that branch is pushed. Raw `.log` files remain intentionally ignored;
the structured results and selected reproducible evidence are kept here.

## Post-review correction — 2026-09-16

An independent review found two false-green paths and one native delivery gap. They are now
fixed in the working tree and verified against an exact-source release build:

- `DraftGuard` no longer calls React Router's `proceed()` from both its state effect and its
  Save/Discard handlers. Regression tests fail on unexpected console errors, and the previous
  `Invalid blocker state transition: unblocked -> proceeding` error is gone.
  - **Follow-up (same day):** the single-effect version still raced under load — 4 of the same
    errors in one loaded run of `drafts.test.tsx`. React Router applies the blocker's state change
    in a transition while a save produces a burst of synchronous draft-store updates, so the guard
    re-renders with the stale `blocked` object and the effect released it again. The effect now
    releases each blocker object at most once (ref-guarded). `DraftGuard.release.test.tsx` models
    the stale window deterministically (fails on the previous code with 3 calls, passes with 1);
    8 further loaded iterations of the drafts tests produced 0 blocker errors.
- The direct cold-launch harness waits for Orbit's process tree to exit, awaits forced cleanup,
  cleans up a child even when CDP attachment fails, validates recursive-deletion targets, and
  waits for the launch log instead of racing it. Campaign stress tests reuse this one harness.
- Native activation emission is single-flight. Selected queue entries are removed only after a
  successful emit to the same live renderer subscription; failed or stale emissions stay queued
  for the next subscription. Renderer unmount/reload explicitly pauses native delivery, and its
  generation token prevents delayed cleanup from disabling a newer renderer's listener.

**Exact verification source:** `98bcb50` plus the reviewed working-tree changes. **Release binary
SHA-256:** `12d34aedaa1f9d676a475000378b236e321723956c8a9a1b989a7ebadfa8000a`.

- Unit/component/storage: **726/726** passed, without the Router exception or async `act` warnings.
- Rust: **54/54** passed, including failed-emission, stale-subscription, delayed-cleanup, and
  newer-click retention.
- Cold functional suite: **3/3** against the final release artifact.
- Cold stress: **30/30** isolated installs and **20/20** reused-session launches; zero losses.
- Desktop WDIO: **7/7 spec files, 12/12 scenarios**.
- Chromium browser E2E: **17/17 scenarios**.
- Firefox browser E2E: **17/17 scenarios** (run 2026-09-16, after the Playwright browser cache was
  moved out of `AppData` — see TI-006; the earlier "not run" was an environment gap, now closed).
- WebKit browser E2E: **16/17**. `startup.spec.ts` (cold start with 7.5k seeded records) fails
  deterministically in WebKit — recorded under TI-006 as an open observation, not a pass.
- Lint, formatting, TypeScript (app/desktop/campaign), Cargo fmt/check/Clippy, production PWA
  build, and the bundle budget passed.

`results-phaseB.json` remains the original chronological campaign record. Its intermediate and
final non-zero exits—including B19—are historical observations, not the post-review gate above.

## PD-001 — Cold `orbit://` activation dropped (product) · FIXED

Delivery now waits for **both** database readiness and the main window confirming its
`orbit:activate` listener, so the shell can never emit before the listener exists.

- `apps/orbit/src-tauri/src/resident.rs`: added `activation_subscribed` to `Resident`; a pure
  `can_flush(phase, subscribed, queued)` gate and a `flush_activation(app)` helper; `activate()`
  now always queues then flushes; `mark_ready()` flushes instead of emitting directly; new
  `resident_activation_subscribed` command (main-window only) sets the flag and flushes.
- `apps/orbit/src-tauri/src/lib.rs`: registered the new command.
- Frontend seam mirroring `captureSubscribed`: `platform/types.ts`, `platform/desktop.ts`,
  `test/desktop.ts`, and `features/desktop/ResidentBridge.tsx` (calls `activationSubscribed()`
  after its listeners attach). New unit test in `ResidentBridge.test.tsx`; Rust `can_flush`
  truth-table test.

**Verified:** `cargo test` 51 passed; `pnpm test` 725 passed. End-to-end against the rebuilt
binary: isolated per-launch **30/30** opened the record (was ~8–17% lost), reused-session race
**20/20**, functional cold e2e **3/3** (`results-phaseB.json` B01–B03).

## TI-002 — Cold e2e never exercised activation (harness) · FIXED

- `tests/e2e/tauri/wdio.conf.ts`: removed the `/s+/` split and the whole broken cold branch.
- New supported cold path using direct-argv launch over WebView2 CDP:
  `tests/e2e/desktop/{coldLaunch.ts, seedDb.ts, cold-activation.e2e.ts, vitest.config.ts,
tsconfig.json}`. `package.json` `e2e:desktop:cold` now runs it; a **Cold activation** job was
  added to `.github/workflows/data-safety.yml` (Windows). Retired
  `scripts/e2e-desktop-cold.ts` and `tests/e2e/tauri/specs/activation-cold.spec.ts`.

**Verified:** `pnpm run e2e:desktop:cold` green (B01). This is PD-001's CI regression gate.

## TI-003 — Desktop specs didn't await first run (harness) · FIXED (first-run)

- `tests/e2e/tauri/specs/helpers.ts`: shared `dismissFirstRun()` (waits for the welcome button,
  clicks through, tolerates an already-onboarded session) and `secondWindowHandle()`.
- Replaced the `if (await start.isExisting())` idiom in activation, reminders, resident, search,
  and zz-resident-quit specs; `transactions.spec.ts` now waits for the capture window handle.

- The reload-flakiness that this surfaced was fixed centrally: `helpers.ts` now provides a
  resilient `goto()` (retries a WebView2 reload that fails to re-establish the Tauri IPC and
  stalls on the "Opening Orbit…" splash), an `expectTodayHeading()` that re-queries `h1` each
  poll (a plain `toHaveText` caches a handle that goes stale during a post-reload re-render),
  and `dismissFirstRun()` settles on a stable Today heading. activation, search, and reminders
  specs use them.

**Verified:** desktop WDIO suite went from **1/7 → 7/7**, stable across three consecutive runs
(B15–B17).

### Follow-up product bug found and FIXED — warm activation bypassed the draft guard

Getting `activation.spec` test 2 green surfaced a **real Week-12 gap**: a warm `orbit://`
activation (a notification click while Orbit runs) navigated away from a note with unsaved
edits **without** triggering the DraftGuard — the edit was lost. `useBlocker` only catches
in-app router navigations; the activation runs from a shell-event callback, so, like the PWA
reload and desktop quit, it must ask through `confirmLeave()` explicitly.

- `apps/orbit/src/features/desktop/ResidentBridge.tsx`: the `orbit:activate` handler now, once
  first run is done, calls `confirmLeave('open the record')` before navigating — but only when
  the target pathname differs from the current one, so reopening the record already on screen
  never prompts (mirroring the blocker's own condition). Saves/discards flow through the same
  guard dialog, then the activation proceeds.
- Regression tests: a new unit test in `ResidentBridge.test.tsx` (dirty draft → activation →
  guard asks → Save → proceeds) and the end-to-end `activation.spec.ts` test 2. The background
  task that had been filed for this was withdrawn (fixed here).

**Verified:** `pnpm test` (the unit test), and the desktop suite's activation spec (7/7 ×3).

## TI-001 — Browser planning tests flaked by wall clock (harness) · FIXED

- `playwright.config.ts`: pinned `use.timezoneId: 'Asia/Amman'`.
- `tests/e2e/playwright/core-loop.spec.ts`: `test.beforeEach` sets a fixed morning via
  `page.clock.setFixedTime(new Date('2026-09-14T06:00:00Z'))` (09:00 Amman), fixing what
  `new Date()` returns without faking timers.

**Verified:** `pnpm exec playwright test` **17/17** green, run at 17:57 local — the exact
afternoon window that failed before (B05).

## TI-004 — `edge:driver` kept a stale driver (harness) · FIXED

- `scripts/edge-driver.ts`: when the cached `version.txt` is absent or mismatched, delete the
  cached `msedgedriver.exe` and `version.txt` before calling `download()` (which otherwise
  early-returns on mere file existence).

**Verified:** with a faked mismatched `version.txt`, the script re-downloaded and corrected the
version (B06 log: "Downloading Edgedriver …", no early return).

## TI-005 — Rust tests not in CI (harness) · FIXED

- `.github/workflows/ci.yml`: added `cargo test --manifest-path apps/orbit/src-tauri/Cargo.toml`
  to the `rust` job after `cargo check`.

## TI-006 — Chromium-only automation (harness) · FIXED

- `playwright.config.ts`: added `firefox` and `webkit` projects.
- `.github/workflows/e2e.yml`: installs chromium + firefox + webkit. `data-safety.yml` stays
  Chromium-only (its checks are storage-engine specific).

**Verified locally (2026-09-16), full suite per engine:** chromium **17/17**, firefox **17/17**
(two consecutive parallel runs plus serial repeats), webkit **16/17**.

**Firefox — the earlier "machine SxS fault" diagnosis was wrong.** The `spawn UNKNOWN` /
_"Dependent Assembly mozglue … could not be found"_ failure was caused by **MSIX filesystem
virtualization of the Claude desktop app**, not by Windows. `playwright install` had been run from
inside Claude Code, whose `AppData\Local` writes are redirected to
`%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\`. Inside that app the merged view
shows `…\AppData\Local\ms-playwright\firefox-1543\…`, but the real path is empty — and Firefox's
manifest makes `csrss.exe` (a system process outside the package) probe the real path for the
`mozglue` private assembly, which is why Chromium/WebKit launched and Firefox alone did not.
Confirmed by: identical bytes copied outside `AppData` launch fine (`Mozilla Firefox 155.0`); a
junction into the folder still fails; ACL, EFS, case-sensitivity, AppCompat, and IFEO were ruled
out; `sfc`/`DISM` would not have helped. Fix applied: `PLAYWRIGHT_BROWSERS_PATH` set (in the
user's own shell, so it lands in the real `HKCU`) to `C:\Users\User\pw-browsers` and the
browsers installed there; all three engines launch from any context. CI (`e2e.yml`, Linux) was
never affected. The same mechanism explains "'pnpm' is not recognized" in the user's own
terminals: the global install lived in the package's `LocalCache\Roaming\npm`.

**WebKit — open observation (not a product defect until investigated).** `startup.spec.ts`
("cold start to interactive stays inside the budget with 5k tasks") fails deterministically in
WebKit (3/3 serial): after seeding 7,544 records, `/today` renders the shell (heading, plan-for
and energy controls) but the `focus` and `plan-panel` regions never appear; in the parallel run
`page.goto('/today')` did not reach `load` within 120 s. Chromium and Firefox reach interactive
in ~1.0–1.05 s on the same fixture. Candidates: a WebKit-specific IndexedDB/read-path stall in
the app, or a Playwright-WebKit-on-Windows performance artifact. Needs a profile before
classifying; the other 16 WebKit scenarios pass.

## Q-001 — Bundle budget red (quality) · ACCEPTED (documented rebaseline)

- `bench/bundle-baseline.json` rebased from **340,047 → 452,602 B** JS gzip (442.0 KB) via
  `node scripts/check-bundle.mjs --update`.

**Justification:** the growth is `react-markdown`, which lands only in the lazily-loaded
`NotePreview` chunk (35.7 KB gzip), so the notes preview pays for it, not first paint. Total JS
gzip 442 KB is comfortably under the **600 KB hard cap**. This rebaseline is deliberate and
recorded here, matching the Week-12 plan's intent. **Verified:** `pnpm run check:bundle` green
(0.0% change, B07).

## Q-002 — Dev-tooling advisories (quality) · ACCEPTED (documented)

`pnpm audit` reports 5 advisories (3 high/1 moderate/1 low), all in the `@wdio/*` and `mocha`
dev-test toolchain (`extract-zip`, `serialize-javascript`). **None are in the shipped app's
runtime dependency tree**, so there is no product exposure. `extract-zip` has **no patched
version available** (advisory patched range `<0.0.0`), so `pnpm audit` cannot be made clean, and
forcing overrides on the others risks breaking the WDIO/mocha toolchain that the desktop e2e
depends on. Per the plan's fallback, these are accepted as dev-only risk and tracked here rather
than force-overridden. Re-check when the upstream tools ship fixes.

## Original regression sweep

The initial campaign produced both passing and failing reruns, recorded chronologically in
`results-phaseB.json`. In particular, B19 was non-zero and was not a valid final green gate.
The authoritative post-review verification is the dated section at the top of this document.
