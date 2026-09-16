# Orbit — Current-state testing campaign: findings register

> **Historical baseline:** statuses below describe the initial campaign. Current fixes,
> corrections, and verification evidence are recorded in `FIXES.md`.

Report-first campaign per `PLAN (4).md`. Source under test: **HEAD `68982ff`** plus the
uncommitted Week-12 native-activation work in the working tree (18 modified, 7 untracked
files). Source-tree digest `a475ad08…5f5bfb` (`snapshot-pre.json`). Desktop binary
`orbit.exe` sha256 `6f4405cf…b8e207`, built this session with `pnpm run tauri:build:bin`.
Environment: Windows 11 Pro 26200, Node v24.20.0, pnpm 9.15.9, rustc 1.98.1, WebView2 &
Edge WebDriver 153.0.4234.32, tz Asia/Amman (Jordan), locale en-US.

No application behaviour was changed. Only test-only files were added (`tests/campaign/**`,
`docs/testing/**`). Nothing was committed, pushed, or published.

Severity: P0 critical · P1 high · P2 medium · P3 low. Confidence: High / Medium / Low.

---

## Product defects

### PD-001 — Cold `orbit://` activation is silently dropped on a fraction of launches · P2 · High

**Category:** product defect (Week-12 notification/protocol activation).

**Build/env:** real `orbit.exe` `6f4405cf…`, isolated data dir + WebView2 profile per launch,
argv passed verbatim over WebView2 CDP (`tests/campaign/desktop/coldLaunch.ts`).

**Preconditions:** Orbit is not running; a reminder is clicked (or the `orbit://` protocol is
invoked) so the process starts with the URI as a launch argument. Fresh, populated, or
first-run installs all reproduce.

**Steps:** launch `orbit.exe orbit://task/<uuid>` (or `bill/`, `commitment/`) against a data
folder holding that record. Repeat.

**Expected:** the main window opens the named record (or the safe `/missing` page if gone).

**Actual:** on a fraction of launches Orbit opens on **/today**, ignoring the activation. No
error, no toast, nothing written — the click is simply lost.

**Frequency:** reproduced across three independent harness designs:

| Harness                                     | Opened target | Lost |
| ------------------------------------------- | ------------- | ---- |
| reused session, no exit barrier (20×)       | 17            | 3    |
| reused session, wait-for-exit barrier (20×) | 17            | 3    |
| **fully isolated per launch** (12×)         | 11            | 1    |

~8–17%. It survives full per-launch isolation and a process-exit barrier, so it is **not** a
harness reuse artifact.

**Evidence:** `evidence/activation-mechanism.md`, `evidence/cold-activation-race.json`,
`evidence/cold-activation-isolated.json`. Shell-log signature of a lost launch:
`activate {queued:false}` with no following `app:activation:open` webview event; a delivered
launch logs `activate {queued:true}` → `ready {queuedActivation:1}` → `app:activation:open`.

**Suspected cause (separated from the verified facts above):**
`resident::apply_launch_policy` calls `activate()` at the end of Tauri `setup()`. On a fast
boot the frontend can reach `mark_ready` **before** `apply_launch_policy` runs. `activate()`
then sees `phase == Ready` and takes the immediate branch — a single fire-and-forget
`emit_to(MAIN_WINDOW, "orbit:activate", …)` with no queue and no replay — which races the
main window's `orbit:activate` listener registration in `ResidentBridge` and is dropped when
it loses. The queued path is safe because `mark_ready` drains the queue after the listener is
attached. A fix would make the Ready-branch emit durable (retain-and-replay, or an ack from
the window, or always route through the queue+drain).

**User impact:** clicking a reminder opens Orbit but not the reminded item; the user lands on
Today and must find the record manually. No data loss. **Workaround:** click the notification
again once Orbit is open (warm path is reliable), or navigate by hand.

**Regression test:** `tests/campaign/desktop/cold-activation-isolated.campaign.test.ts` (fails
today; should pass once the race is fixed). Also fix TI-002 so the shipped e2e exercises this.

---

## Test-infrastructure findings

These block trustworthy results (PLAN §2, "validate the test harness itself"). None change
product behaviour, but two of them **mask PD-001**.

### TI-002 — Cold-activation e2e never exercises activation (arg split on the letter "s") · P1 · High

`tests/e2e/tauri/wdio.conf.ts:35`:

```ts
const launchArgs = (process.env.ORBIT_E2E_ARGS ?? '').split(/s+/).filter(Boolean);
```

The regex is `/s+/` (the literal letter _s_), not `/\s+/` (whitespace). A URI like
`orbit://task/…e2` is split into `["orbit://ta", "k/00000000-0000-7000-8000-0000000000e2"]`,
so the process is launched with mangled arguments. Independently, Edge WebDriver forwards
`tauri:options.args` to the app as `--<arg>` (verified: the running process shows
`orbit.exe --orbit://task/…`), which `Launch::from_args` treats as a manual launch. Net
effect: `pnpm run e2e:desktop:cold` / `activation-cold.spec.ts` **passes through no
activation at all** — it starts a plain manual launch and then times out waiting for
`/missing`, so the feature has effectively zero working automated coverage. This is why
PD-001 shipped unnoticed. Fix: `split(/\s+/)`, and launch the real binary with argv directly
(as `tests/campaign/desktop/coldLaunch.ts` does) rather than through the Edge-WebDriver arg
path.

**Evidence:** `logs/A18-e2e-desktop-cold.log`, `logs/A18b*`, `evidence/activation-mechanism.md`.

### TI-003 — Desktop WDIO suite is red: 6/7 specs don't await first-run before asserting Today · P1 · Medium

`pnpm run e2e:desktop`: 1 spec passed, 6 failed (`logs/A17-e2e-desktop.log`). Every failure
is `expect($('h1')).toHaveText(/^(Today|Tomorrow)$/)` receiving **"Welcome to Orbit"**. The
one passing spec (`core-loop.spec.ts`) dismisses first run with
`start.waitForDisplayed()` then `.click()`; the others use
`if (await start.isExisting()) await start.click()`, which evaluates existence once before the
welcome button renders, skips the click, and asserts on the welcome page. `core-loop`'s "first
run lands on Today" passing proves first-run completion works on the real binary, so this is a
harness race in the specs, not a product regression. Fix: await the button (or a shared
`await firstRun()` helper) at the top of each spec.

### TI-001 — Browser E2E planning assertions are wall-clock dependent (no injected clock) · P2 · High

`pnpm exec playwright test`: 15 passed, 2 failed (`logs/A14-e2e-browser-chromium.log`). Both
failures are `getByRole('list', {name:'Proposed plan'}).getByRole('listitem')` expecting **3**,
receiving **2**, in `core-loop.spec.ts:122` and `:230`. The default working window is
09:00–18:00 (`DEFAULT_WORKING_WINDOW = {540,1080}`); the run was at ~16:12 local, leaving
~1h45m free, which fits only two 30-minute tasks. The failure snapshot confirms the planner
behaved correctly ("2 · 1h of 1h 45m free", "Left out (1)"). **This is not a product bug** —
the tests assume an open working day and use no injected clock, so they flake every afternoon.
Fix: inject a fixed clock into the browser build for E2E (Playwright `page.clock`, or a test
seam), or assert against remaining capacity rather than a hard count.

### TI-004 — `edge:driver` keeps a stale driver after a WebView2 update · P2 · Medium

`scripts/edge-driver.ts` treats a present `msedgedriver.exe` as up to date only via its own
`version.txt`; but `edgedriver.download()` returns early on mere file existence
(`node_modules/edgedriver/dist/install.js:21`, `hasAccess`), so when the on-disk driver is a
different version than requested it is **not** replaced. Observed: the cached driver was
152.0.4191.66 while `version.txt`/WebView2 were 153.0.4234.32; `pnpm run edge:driver` printed
"Fetching Edge WebDriver 153…" but left the 152 binary in place. After a real WebView2 auto-
update this makes `e2e:desktop` fail at session start with a version-mismatch error. Fix:
delete the cached driver (or use a versioned cache dir) before download when the requested
version differs from `version.txt`. (Worked around this session by clearing `.driver/`.)

### TI-005 — Rust unit tests are not run in CI · P2 · Medium (plan-noted, confirmed)

`.github/workflows/ci.yml` runs `cargo fmt --check`, `clippy -D warnings`, `cargo check` — but
not `cargo test`. 50 Rust unit tests exist and pass locally (`logs/A07-cargo-test.log`),
including transaction-ownership, restore-verifies-first, scheduler, and activation-parser
vectors. They gate nothing in CI. Fix: add `cargo test --manifest-path apps/orbit/src-tauri/Cargo.toml`.

### TI-006 — Browser automation covers Chromium only · P2 · Low (plan-noted, confirmed)

`playwright.config.ts` defines a single `chromium` project; `data-safety.yml` and `e2e.yml`
install `--with-deps chromium`. Firefox, WebKit, and Edge are not exercised. Adds no product
finding but leaves cross-engine storage/behaviour untested in automation.

---

## Quality / build findings

### Q-001 — Bundle budget check fails: JS gzip +33.1% over baseline · P3 · High

`pnpm run check:bundle` exits 1: **442.0 KB** JS gzip vs a **332.1 KB** baseline (limit +20%),
driven by `react-markdown` (the `NotePreview` lazy chunk, 35.7 KB gzip) plus growth in the
main `index` chunk (796 KB raw / 236 KB gzip; Vite also warns it exceeds 500 KB). The Week-12
work is expected to rebase this baseline with a written justification (per the project's own
Week-12 notes); until then the check is red. Confirm `NotePreview` is genuinely lazy (it is a
separate chunk) and rebaselining is deliberate, not masking a regression in the main chunk.

### Q-002 — Dev-toolchain dependency advisories (no product exposure) · P3 · Medium

`pnpm audit`: 5 advisories (3 high, 1 moderate, 1 low), all under `@wdio/*` / `mocha`
(`extract-zip`, `serialize-javascript`). None are in the shipped app's runtime dependency tree
(no path through react/dexie/zod/tauri/etc.), so there is **no product exposure** — these are
desktop-e2e tooling only. Track for hygiene; not a release blocker.

---

## Coverage observations (not defects on their own)

- Unit/component: **724 tests pass**; coverage lines 87.3%, branches 76.4%, functions 80.3%
  (`logs/A04-test-coverage.log`). Thresholds met.
- **0% component coverage** on `TaskPage.tsx` — which is the activation _target_ for tasks
  (PD-001) — plus `DiagnosticsBridge.tsx` and `InsightsProvider.tsx`. Thin branch coverage
  around transaction/draft logic the plan flags: `weeklyService.ts` 54%, `structureService.ts`
  65%, `ProjectPage.tsx` 60%, `TaskEditor.tsx` 57%.
- Data-integrity suites are green and give real assurance: 50k export→import roundtrip,
  IndexedDB+SQLite migration matrix, `verify:backup` (restore-verifies-first, WAL sidecars),
  and 50 Rust tests incl. cross-window DB ownership. See the coverage matrix in `REPORT.md`.
