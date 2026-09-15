# Orbit — fixes applied for the campaign findings

Follow-up to `FINDINGS.md`. Each finding below was fixed and re-verified against the real
binary/build where applicable. The desktop binary was rebuilt after the PD-001 change
(`orbit.exe` sha256 `9ee63d73…07ff43fc`). Nothing was committed, pushed, or published.

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

**Verified locally:** chromium ✓ and webkit ✓ pass the full `core-loop` suite (12/12 across the
two engines, including the fixed-clock planning tests), so cross-engine compatibility holds.

**Firefox — local launch blocked by a machine Windows issue, not the repo.** Playwright's
Firefox fails to launch on this dev machine with `browserType.launch: spawn UNKNOWN`; the
Windows event log shows the real error: _"side-by-side configuration is incorrect … Dependent
Assembly mozglue … could not be found."_ Diagnosed and ruled out: `mozglue.dll` is present next
to `firefox.exe`; a clean 122 MB re-download reproduces it; VC++ 2012/2013/2022 redistributables
are all installed and every imported DLL resolves; Smart App Control is OFF, Controlled Folder
Access is OFF, and there are no WDAC/CodeIntegrity block events for firefox/mozglue. It is a
Windows SxS activation-context resolution failure specific to this machine — remediable only by
an elevated system repair (`sxstrace` → `sfc /scannow` / `DISM /RestoreHealth`), which is a
system-level change left to the user. The repo change is complete and correct: Firefox is wired
into `playwright.config.ts` and installed in CI (`e2e.yml`, Linux runner with `--with-deps`,
where it launches normally), and WebKit locally already proves the cross-engine setup works.

## Q-001 — Bundle budget red (quality) · FIXED (documented rebaseline)

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

## Regression sweep

`pnpm run lint`, `pnpm run type-check`, `pnpm test` (725), `pnpm run format:check`, the campaign
and e2e-desktop `tsc` projects, and `cargo fmt/clippy/test` all pass (B08–B10, phase-A data-
safety suites unchanged). Two unit tests flaked once under machine load (lazy `NotePreview`
import timeout) and passed on isolated re-run and a clean full re-run (B10b, 725/725).
