# Orbit — Current-state testing campaign report

> **Historical baseline:** this report records the report-first campaign before fixes were
> applied. For current dispositions and post-review verification, read `FIXES.md`.

**Date:** 2026-09-15 · **Source:** HEAD `68982ff` + uncommitted Week-12 activation work ·
**Tree digest:** `a475ad08…5f5bfb` · **Binary:** `orbit.exe` `6f4405cf…b8e207`.
Report-first per `PLAN (4).md`: this is a reproducible bug list with evidence and honest
coverage, not a set of product fixes. No application code was changed; nothing was committed,
pushed, or published.

## 1. Executive summary

The engine, storage, and data-safety layers are in good shape: 724 unit/component tests, the
50k export/import roundtrip, the IndexedDB+SQLite migration matrix, backup restore-verifies-
first, and 50 Rust unit tests all pass on this tree. Lint, format (excluding campaign files),
type-check, and both production builds pass.

The **Week-12 native activation feature is the weak point**. One genuine product defect was
found and reproduced against the real desktop binary — **PD-001: cold `orbit://` activation is
silently dropped on ~8–17% of launches** — together with the reason it went unnoticed:
**TI-002**, the shipped cold-activation e2e splits its launch argument on the letter "s" and
never actually exercises activation. Two more harness defects (TI-001 wall-clock-flaky browser
planning tests; TI-003 desktop specs that don't await first run) currently paint the automated
suites red for reasons unrelated to product correctness.

### Recommended repair order

1. **PD-001** — make Ready-branch activation delivery durable (queue/replay or ack). _Real
   user-facing defect._
2. **TI-002** — fix the arg split and drive the binary with argv directly so cold activation
   is actually covered (this is what would have caught PD-001).
3. **TI-003** — await first run in the desktop specs so the suite is green and meaningful.
4. **TI-001** — inject a fixed clock into the browser E2E so planning tests stop flaking each
   afternoon.
5. **TI-005** — add `cargo test` to CI. **TI-004** — fix stale-driver replacement.
6. **Q-001** — deliberately rebaseline the bundle budget with the written justification (or
   split the main chunk). **Q-002** — track dev-tooling advisories.

Full detail and evidence: `FINDINGS.md`.

## 2. What ran — status of the existing checks

| Stage                      | Command                         | Exit  | Note                                                       |
| -------------------------- | ------------------------------- | ----- | ---------------------------------------------------------- |
| Lint                       | `pnpm run lint`                 | 0     | clean                                                      |
| Format                     | `pnpm run format:check`         | 1     | only campaign output files; app tree clean (`A02b` exit 0) |
| Type-check                 | `pnpm run type-check`           | 0     | all 3 projects                                             |
| Unit/component + coverage  | `pnpm run test:coverage`        | 0     | 724 passed; lines 87.3%                                    |
| Rust fmt / clippy / test   | `cargo fmt/clippy/test`         | 0     | 50 Rust tests pass                                         |
| Roundtrip 50k              | `pnpm run test:roundtrip`       | 0     | 3 passed                                                   |
| Migrations                 | `pnpm run test:migrations`      | 0     | 15 passed                                                  |
| Backup verify              | `pnpm run verify:backup`        | 0     | 24 tables, restore identical                               |
| Fixtures current           | `pnpm run make:fixture` + diff  | 0     | no drift                                                   |
| Web build                  | `pnpm --filter orbit run build` | 0     | PWA precache 44 entries                                    |
| **Bundle budget**          | `pnpm run check:bundle`         | **1** | **Q-001**: +33.1% > 20%                                    |
| **Browser E2E (Chromium)** | `playwright test`               | **1** | 15 pass / 2 fail = **TI-001** (flaky by clock)             |
| Desktop build (bin)        | `pnpm run tauri:build:bin`      | 0     | binary hashed                                              |
| **Desktop E2E**            | `pnpm run e2e:desktop`          | **1** | 1 pass / 6 fail = **TI-003**                               |
| **Desktop cold E2E**       | `pnpm run e2e:desktop:cold`     | **1** | **TI-002**: never exercises activation                     |
| Dep audit                  | `pnpm audit`                    | 1     | **Q-002**: dev-tooling only, no product exposure           |

Every stage's raw log is under `logs/`; machine-readable results in `results-phaseA.json`.

## 3. Coverage matrix (feature → evidence → result)

| Area                                                         | Automated evidence this campaign                                                    | Result                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Capture/parse, planner, rules, recurrence, insights (engine) | core unit tests, planner fixture world                                              | ✅ pass                                                                   |
| Repository guarantees (tx, rollback, ownership, op-log)      | storage contract + 50 Rust tests incl. cross-window ownership                       | ✅ pass                                                                   |
| Migrations (IndexedDB v1–4, SQLite v1–3, export v1–5)        | `test:migrations`, fixture regeneration                                             | ✅ pass                                                                   |
| Export/import roundtrip @ 50k                                | `test:roundtrip` (ROUNDTRIP_SIZE=50000)                                             | ✅ pass                                                                   |
| Backup/restore                                               | `verify:backup` (restore-verifies-first, WAL) + Rust data_dir tests                 | ✅ pass                                                                   |
| Core loop in a real browser (IndexedDB)                      | Playwright `core-loop`, bills, notes, people, search, weekly, insights, data-safety | ✅ 15/17 (2 = TI-001)                                                     |
| Core loop on the real desktop build (SQLite)                 | WDIO `core-loop.spec`                                                               | ✅ pass (rest of suite = TI-003)                                          |
| **Notification/protocol activation (cold)**                  | new `tests/campaign/desktop/*` against the real binary                              | ❌ **PD-001**                                                             |
| Activation (warm, in-app event)                              | source review + WDIO `activation.spec`                                              | ⚠ blocked by TI-003 harness; warm path observed reliable in campaign runs |
| Markdown/link security                                       | source review (`skipHtml`, scheme allowlist, decode-mismatch block)                 | ✅ no XSS surface found                                                   |
| `orbit://` parsing (strict)                                  | Rust + TS shared vectors (`orbit-uris.json`)                                        | ✅ pass                                                                   |
| Dependency vulnerabilities                                   | `pnpm audit`                                                                        | ⚠ dev-tooling only (Q-002)                                                |
| Desktop readiness timing                                     | readiness probe ×3                                                                  | ℹ️ 156–413 ms to first-run button                                         |

## 4. Not run (honest gaps) — reason and what it would take

Per PLAN §2, unavailable environments are recorded, not faked.

| Planned coverage                                                                                                                                                                               | Status      | Blocker                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installed NSIS build in a clean VM: install → autostart → protocol registration → upgrade → uninstall, real single-instance, Focus Assist, forced termination, **real toast-click activation** | **NOT RUN** | No disposable Windows VM available here; single-instance is off under `ORBIT_DATA_DIR` by design. This is the definitive check for PD-001's real-world path and a release gate.                                 |
| Cross-browser: Firefox, WebKit (added 2026-09-16)                                                                                                                                              | **RUN**     | Firefox 17/17; WebKit 16/17 — `startup.spec.ts` fails deterministically in WebKit (open observation, FIXES.md TI-006). Needed the Playwright cache moved out of `AppData` (Claude desktop MSIX virtualization). |
| Edge, Android Chrome/PWA, iPhone Safari/PWA                                                                                                                                                    | **NOT RUN** | Edge not configured as a Playwright project; no real phones.                                                                                                                                                    |
| NVDA / VoiceOver manual screen-reader passes; 200%/400% reflow manual review                                                                                                                   | **NOT RUN** | Manual AT + human review required.                                                                                                                                                                              |
| 8-hour endurance per runtime; 20+ cold-start perf samples on a reference machine; large (50k/10k) perf against real IndexedDB & SQLite                                                         | **NOT RUN** | Long-running; needs a pinned reference machine and dedicated time.                                                                                                                                              |
| Network capture during desktop/PWA journeys                                                                                                                                                    | **NOT RUN** | Requires a controlled capture harness; source review found no outbound calls in the app tree.                                                                                                                   |
| Phase I (post-Week-13) rerun and acceptance tests                                                                                                                                              | **NOT RUN** | Week-13 candidate does not exist yet.                                                                                                                                                                           |

“Zero bugs found” is not claimed for any NOT-RUN row.

## 5. Reusable deliverables added (test-only)

Under `tests/campaign/` — none imported by the app; a separate Vitest project
(`tests/campaign/vitest.config.ts`) and a stage runner keep them out of `pnpm test`:

- `snapshot.ts` — records source/tree/toolchain identity (`snapshot-pre.json`).
- `run-stage.ts` — runs one check, logs it, appends exit status (`results-phaseA.json`).
- `desktop/coldLaunch.ts` — launches the **real** binary with argv verbatim + WebView2 CDP,
  isolated data dir/profile, shell-log reader, timings. The correct way to test cold
  activation (see TI-002).
- `desktop/seedDb.ts` — writes a known dataset into a SQLite file with the production adapter.
- `desktop/cold-activation*.campaign.test.ts` — direct-launch, race, fully-isolated, and
  trace-on-loss variants that reproduce PD-001 and would pass once it is fixed.
- `desktop/readiness-probe.spec.ts` + wrappers — desktop time-to-ready diagnostics.

## 6. Limitations

Single reference machine; single timezone (Asia/Amman) and locale (en-US); Chromium-only
browser automation; desktop single-instance and window-state are disabled in isolation by
design, so real single-instance/autostart/protocol-registration behaviour is untested here.
Release readiness is a separate judgement: PD-001 (a lost notification click) and the
NOT-RUN installed-VM activation path should both be resolved/exercised before the activation
feature is called done.
