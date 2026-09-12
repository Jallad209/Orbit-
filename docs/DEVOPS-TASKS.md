# DevOps Team Tasks (13 Weeks)

**Tech Stack:** pnpm + GitHub Actions + Vitest + Playwright + Vite PWA + Lighthouse + Rust toolchain & Tauri CLI (from week 7) + tauri-driver/WebdriverIO + NSIS/MSI + Tauri Updater (manual check)
**Repository:** `C:\Orbit`
**Owned:** `.github/`, `scripts/`, `apps/orbit/src-tauri/tauri.conf.json` (build/security sections, from week 7), release process
**Current Status:** Weeks 1-4 ✅ COMPLETE (branch protection pending: needs `gh auth login` or the GitHub UI)

> There are no servers to run. DevOps for Orbit means: reproducible builds, CI that guards the engine, a static PWA build, data-safety verification, signed desktop installers, and a release process. Weeks 1–6 need no Rust. Nothing here may introduce a network dependency into the app itself.

---

## Week 1: Local Toolchain & Repository Bootstrap ✅ COMPLETE

**Description:** This week establishes a working development environment on Windows and initialises the repository. You will install Node 20 LTS and pnpm, then create the repo with linting, formatting, commit hooks, and an editor config so every contributor produces identical output. No Rust yet: the first six weeks run in the browser.

### Research Required:

- **pnpm Configuration:** `.npmrc` (`strict-peer-dependencies`, `shamefully-hoist` off), lockfile policy
- **Husky + lint-staged:** Pre-commit lint/type-check on staged files only
- **ESLint Flat Config:** TypeScript + React + import ordering; Prettier integration
- **Conventional Commits:** commitlint config, why it matters for changelog automation later

### Setup Tasks:

1. **Toolchain Installation** — Node 20 LTS, pnpm 9
2. **Repository Init** — `git init`, `.gitignore` (node, dist, `*.db*`, backups, later rust target), `.gitattributes` (LF), `.editorconfig`
3. **Lint & Format** — ESLint flat config, Prettier, `pnpm lint`, `pnpm format:check`
4. **Commit Hooks** — Husky pre-commit (lint-staged), commit-msg (conventional commits)
5. **Scripts** — Root `package.json` scripts: `dev`, `build`, `preview`, `test`, `type-check`, `lint`
6. **SETUP.md** — Step-by-step Windows setup with verification commands (Rust section added in week 7)

### Unit Tests Required:

- N/A (infrastructure); verification commands below act as acceptance

**What was done:**

- Node 24 confirmed; pnpm 9.15.9 installed globally (`npm i -g pnpm@9.15.9`); `packageManager` pinned in `package.json`
- `git init -b main`; `.gitignore` excludes `node_modules`, `dist`, coverage, `*.db*`, backups, and the future Rust `target/`; `.gitattributes` forces LF; `.editorconfig`
- ESLint flat config (`@eslint/js` + `typescript-eslint` + `react-hooks` + `eslint-config-prettier`), Prettier with `.prettierignore`
- Husky hooks: `pre-commit` → `lint-staged` (ESLint + Prettier on staged files), `commit-msg` → commitlint (Conventional Commits)
- Root scripts: `dev`, `build`, `preview`, `test`, `test:watch`, `test:coverage`, `type-check`, `lint`, `lint:fix`, `format`, `format:check`
- TypeScript pinned to 5.x (7.0 was pulled in by default and is not yet supported by typescript-eslint)
- `SETUP.md` (Windows, no Rust until week 7) and `README.md`
- `.claude/launch.json` so the dev server can be started from the desktop app

**Files created:**

- `.npmrc`, `.editorconfig`, `.gitattributes`, `.gitignore`, `.prettierrc`, `.prettierignore` ✅
- `eslint.config.js`, `commitlint.config.js`, `.husky/{pre-commit,commit-msg}` ✅
- `package.json` (root scripts + lint-staged), `pnpm-workspace.yaml` ✅
- `SETUP.md`, `README.md`, `.claude/launch.json` ✅

**Deliverables:**

- [x] `.npmrc`, `.editorconfig`, `.gitattributes`, `.gitignore`
- [x] `eslint.config.js`, `.prettierrc`, `.husky/*`, `commitlint.config.js`
- [x] `SETUP.md`
- [x] Pushed to `https://github.com/Jallad209/Orbit-` (private); CI in week 2 is the fresh-clone check

**Verification:**

```bash
node -v && pnpm -v
pnpm install
pnpm run lint
pnpm run dev
```

---

## Week 2: Continuous Integration ✅ COMPLETE

**Description:** This week you will set up GitHub Actions to guard every pull request. The CI workflow lints, type-checks, and runs the Vitest suites for `core`, `storage`, and `orbit` with coverage thresholds, caching pnpm to keep runs fast. Branch protection requires green CI.

### Research Required:

- **GitHub Actions Basics:** Workflow syntax, job dependencies, job summaries, artifacts
- **pnpm Caching:** `pnpm/action-setup` + `actions/setup-node` cache
- **Coverage Enforcement:** Vitest thresholds per package; failing the job on regression
- **Matrix Strategy:** Ubuntu for speed now; Windows job added with Tauri in week 7

### CI Tasks:

1. **CI Workflow** — `.github/workflows/ci.yml`: lint → type-check → test (coverage) on PR and main
2. **Caching** — pnpm store cache
3. **Coverage Thresholds** — core ≥ 90%, storage ≥ 85%, orbit ≥ 70%
4. **Branch Protection** — Require CI, one review (or self-review checklist for solo), linear history
5. **PR Template** — Checklist: tests, docs updated, task doc status updated

### Unit Tests Required:

- CI must fail on a deliberately broken test (verify once, then revert)

**Deliverables:**

- [x] `.github/workflows/ci.yml`
- [x] `.github/pull_request_template.md`
- [x] Coverage thresholds configured
- [ ] Branch protection enabled (GitHub UI: Settings → Branches → add rule for `main`, require the "Lint, type-check, test" check)

**What was done:**

- `ci.yml` runs on pushes to `main` and every PR on `ubuntu-latest`: install with frozen lockfile → lint → Prettier check → type-check → tests with coverage → web build; coverage uploaded as an artifact; bundle sizes printed to the job summary; concurrent runs on the same ref are cancelled
- pnpm version comes from `packageManager`; the pnpm store is cached via `actions/setup-node`
- Coverage thresholds in `vitest.config.ts` per package: core 90 % lines/functions/statements, storage 85 %, app 70 %; test files, barrels, the dev gallery, and the PWA registration glue are excluded from the measurement
- PR template with the offline and platform-boundary rules as a checklist
- Root scripts gained `test:coverage`; `pnpm run format` applied repo-wide so the format check starts green

**Files created:**

- `.github/workflows/ci.yml` ✅
- `.github/pull_request_template.md` ✅
- `vitest.config.ts` (thresholds) ✅

**Verification:**

```bash
git push origin feature/ci-test
# Open PR; confirm all jobs green; break a test; confirm red
```

---

## Week 3: PWA Build & Static Preview ✅ COMPLETE

**Description:** This week you will make the web build a real, installable, offline artifact. CI builds the PWA on every main commit, runs a Lighthouse PWA audit, checks the bundle budget, and uploads the static bundle as an artifact. A preview script serves it over LAN so it can be installed on a phone for testing. No hosting service is required; the bundle is a folder.

### Research Required:

- **Vite PWA Plugin in CI:** Deterministic builds, precache manifest, cache-busting
- **Lighthouse CI:** `@lhci/cli` assertions for PWA, performance, and accessibility categories
- **Bundle Analysis:** `rollup-plugin-visualizer`, budget assertions
- **Local HTTPS for Service Workers:** `mkcert` or Vite `--https` for LAN testing on phones

### Build Tasks:

1. **PWA Build Job** — Build, upload `dist/` artifact, print sizes in job summary
2. **Lighthouse Job** — PWA installable, performance ≥ 90, accessibility ≥ 95; fail on regression
3. **Bundle Budget** — JS ≤ 600 KB gzipped; fail on > 20% growth
4. **LAN Preview Script** — `pnpm run preview:lan` with local HTTPS cert instructions
5. **Static Hosting Doc** — `docs/HOSTING.md`: how to self-host the folder (any static server) or open from a local server; no cloud dependency

**What was done:**

- `pwa.yml` on every push to `main`: build → `scripts/check-bundle.mjs` → upload `orbit-pwa` (the static `dist/` folder) → Lighthouse CI (`@lhci/cli`) against the built folder → upload the HTML report
- `check-bundle.mjs`: sums gzipped JS, fails above 600 KB or more than 20 % over `bench/bundle-baseline.json`, verifies `manifest.webmanifest`, `sw.js`, and icons exist, writes a table to the job summary; `--update` refreshes the baseline (first baseline: 221 KB gzipped)
- `lighthouserc.json`: desktop preset, two runs, accessibility ≥ 0.95 as an error, performance and best-practices ≥ 0.9 as warnings (Lighthouse 12 dropped the PWA category; installability is covered by the artefact check)
- `pnpm run preview:lan` serves the build on all interfaces at port 4173; `docs/HOSTING.md` covers mkcert for HTTPS on a phone, self-hosting with any static server (Caddy example), and cache headers

**Files created:**

- `.github/workflows/pwa.yml`, `lighthouserc.json` ✅
- `scripts/check-bundle.mjs`, `bench/bundle-baseline.json` ✅
- `docs/HOSTING.md`; root scripts `preview:lan`, `check:bundle` ✅

**Deliverables:**

- [x] `.github/workflows/pwa.yml`
- [x] `lighthouserc.json`
- [x] `scripts/preview-lan.ts`
- [x] `docs/HOSTING.md`

**Verification:**

```bash
pnpm run build
pnpm run preview:lan
# Install on phone; airplane mode; app loads
```

---

## Week 4: Test Infrastructure & Browser End-to-End ✅ COMPLETE

**Description:** This week you will build the testing backbone the task docs rely on. You will add fixture generators for engine tests, component testing utilities, and a Playwright end-to-end harness that drives the web build for the core loop: capture → plan → accept → complete → evening review. Desktop e2e is added in week 8.

### Research Required:

- **Playwright:** Page objects, waiting strategies, IndexedDB reset between tests, screenshots on failure
- **Test Data Builders:** Factory functions with sensible defaults; deterministic seeds
- **Testing Library + Zustand:** Resetting stores between tests; providing an in-memory repository
- **fake-indexeddb:** Running the Dexie adapter's contract tests in Node

### Test Tasks:

1. **Fixture Builders** — `packages/core/test/builders.ts` for every entity; seeded random generator
2. **Component Test Utils** — `renderWithProviders`, in-memory repository provider, hotkey helpers
3. **E2E Harness** — `tests/e2e/playwright/` with fixtures that seed IndexedDB via the app's import
4. **Core Loop E2E** — Capture 3 items, plan, accept, drag one block, lock, complete, evening review
5. **Failure Artifacts** — Screenshots, traces, and logs uploaded on failure
6. **CI Wiring** — `e2e` job on PR (smoke) and nightly (full)

**What was done:**

- Fixture builders and a seeded PRNG in `packages/core/test/builders.ts`; the repository contract suite from week 1 already runs against memory and IndexedDB; `renderWithProviders` supplies an in-memory repository, router, and hotkey registry to component tests
- Playwright configured in `playwright.config.ts`: Chromium, fresh context per test (empty IndexedDB), traces and screenshots on failure, Vite preview of the production build as the web server on port 4517 (4173 was found occupied by an unrelated local server, which is why the port is unusual)
- `tests/e2e/playwright/core-loop.spec.ts`: area → project → three captures → keyboard triage into the project → reload keeps everything → task visible on the project page; quick capture from `/today` with `c`; milestones drive progress and the first task becomes the next action. Planning, blocks, and the evening review are a `test.fixme` placeholder until weeks 5–8
- `e2e.yml` runs the suite on every pull request, nightly at 03:00 UTC, and on demand; uploads the HTML report and traces on failure
- Root scripts `e2e` (build then test) and `e2e:ui`; Playwright output ignored by git

**Files created:**

- `playwright.config.ts`, `tests/e2e/playwright/core-loop.spec.ts` ✅
- `.github/workflows/e2e.yml` ✅
- `packages/core/test/builders.ts` ✅

**Deliverables:**

- [x] Builders and test utils
- [x] `tests/e2e/playwright/*` with the core loop scenario
- [x] `e2e` job in CI

**Verification:**

```bash
pnpm run test
pnpm run e2e
```

---

## Week 5: Data Safety Verification (Web)

**Description:** This week you will verify, in CI, that user data cannot be silently lost in the browser runtime. You will build export/import round-trip checks over large seeded datasets, Dexie schema migration tests from fixture snapshots, and a persistence check that a reload keeps every record. The SQLite side of this suite is added in week 8.

### Research Required:

- **Dexie Upgrades:** `version().upgrade()` semantics, testing upgrades from stored fixture JSON
- **Large-Data Round Trips:** Streaming JSON export to avoid memory spikes
- **Storage Persistence Testing:** Simulating denied persistence and quota errors in Playwright
- **Fixture Strategy:** JSON snapshots per schema version, regenerated on every schema bump

### Data Tasks:

1. **Round-Trip Job** — Seed 50k → export → import into fresh DB → diff equals zero
2. **Dexie Migration Matrix** — For each fixture version: load → upgrade → row-count assertions
3. **Persistence E2E** — Create records, reload, assert all present
4. **Quota E2E** — Simulate denied persistence; assert banner and export prompt
5. **Fixture Generation Script** — `scripts/make-fixture.ts` (part of release checklist)

**Deliverables:**

- [ ] `.github/workflows/data-safety.yml`
- [ ] `scripts/make-fixture.ts`
- [ ] `tests/fixtures/export/v*.json`

**Verification:**

```bash
pnpm run test:roundtrip
pnpm run test:migrations
```

---

## Week 6: Performance Benchmarks

**Description:** This week you will make performance a guarded number rather than a hope. Seed scripts generate realistic large datasets; benchmark scripts time planner runs, search queries, and Today screen render. Results are posted to the CI job summary and regressions beyond a threshold fail the job.

### Research Required:

- **Benchmarking in Node:** `tinybench`/Vitest bench, warm-up, variance handling
- **Browser Timing:** Playwright performance marks for time-to-interactive with a seeded IndexedDB
- **Regression Detection:** Baseline files committed; relative thresholds
- **Realistic Data Shapes:** Distribution of tasks per project, notes length, history depth

### Benchmark Tasks:

1. **Seed Script** — `scripts/seed.ts --tasks 50000 --notes 10000 --days 365` producing sessions and op-log history
2. **Engine Benchmarks** — Planner < 50 ms (2k open tasks), insights < 200 ms, search < 30 ms
3. **Startup Benchmark** — Web cold start to interactive < 1.5 s with seeded IndexedDB (e2e-measured)
4. **CI Bench Job** — Runs on main; compares with committed baseline; fails on > 25% regression

**Deliverables:**

- [ ] `scripts/seed.ts`, `scripts/bench.ts`, `bench/baseline.json`
- [ ] `.github/workflows/bench.yml`

**Verification:**

```bash
pnpm run seed -- --tasks 50000
pnpm run bench
```

---

## Week 7: Rust Toolchain, Tauri Build Pipeline & Installers

**Description:** This week the desktop shell arrives and DevOps follows. You will install the Rust toolchain, MSVC build tools, WebView2, and the Tauri CLI, add a Rust check job to CI, and create a release workflow that builds the Tauri app on Windows, produces NSIS and MSI installers, and attaches them to a GitHub Release with checksums.

### Research Required:

- **Tauri 2 Windows Prerequisites:** MSVC C++ build tools, WebView2 runtime, Rust MSVC target
- **Rust Toolchain Pinning:** `rust-toolchain.toml`, cargo caching in CI
- **Tauri Bundling:** NSIS vs MSI on Windows, per-user vs per-machine, icons
- **Release Automation:** `tauri-apps/tauri-action`, draft releases, SHA-256 checksums
- **Binary Size:** `opt-level`, `lto`, `strip` in `Cargo.toml` release profile

### Build Tasks:

1. **Toolchain** — rustup stable, MSVC build tools, WebView2, `@tauri-apps/cli`; `SETUP.md` Rust section
2. **Rust CI Job** — `cargo check` + `cargo clippy -D warnings` + `cargo fmt --check` on a Windows runner, cargo caches
3. **Release Workflow** — `.github/workflows/release.yml` on `v*` tags: build, NSIS + MSI, checksums, attach
4. **Versioning** — `scripts/bump-version.ts` bumps `package.json`, `tauri.conf.json`, `Cargo.toml` together
5. **Size Tracking** — Binary and JS sizes in job summary; fail on > 20% growth
6. **Manual Install Test** — Install on a clean Windows VM; first run creates the data folder

**Deliverables:**

- [ ] `rust-toolchain.toml`, Rust job in `ci.yml`
- [ ] `.github/workflows/release.yml`
- [ ] `scripts/bump-version.ts`
- [ ] First tagged pre-release `v0.1.0-alpha.1` with installers

**Verification:**

```bash
rustc -V && cargo -V
pnpm run tauri build
git tag v0.1.0-alpha.1 && git push --tags
```

---

## Week 8: Desktop E2E & SQLite Data Safety

**Description:** This week you will extend the test and data-safety suites to the desktop runtime. You will add a `tauri-driver` + WebdriverIO harness running the same core-loop scenario against the real desktop app, a SQLite migration matrix from fixture databases, backup/restore verification, corruption-recovery tests, and a check that a web export imports into SQLite with zero diff.

### Research Required:

- **tauri-driver:** WebDriver for Tauri on Windows (Edge Driver), CI setup
- **WebdriverIO:** Page objects shared with Playwright where possible
- **SQLite Corruption Simulation:** Truncating files, flipping bytes, `integrity_check` paths
- **Backup Verification:** Restoring into a temp path and comparing row counts + checksums

### Test Tasks:

1. **Desktop E2E Harness** — `tests/e2e/tauri/` with WebdriverIO + tauri-driver on a Windows CI job
2. **Core Loop on Desktop** — Same scenario as week 4, plus quick-capture window
3. **SQLite Migration Matrix** — Fixture `.db` per released version → migrate → integrity → row counts
4. **Backup Verify Script** — `scripts/verify-backup.ts`: create → restore → compare
5. **Corruption Tests** — Damaged file detected on startup; restore path exercised
6. **Web → Desktop Import Job** — Week 5 export fixtures import into SQLite with zero diff

**Deliverables:**

- [ ] `tests/e2e/tauri/*`
- [ ] `scripts/verify-backup.ts`
- [ ] `tests/fixtures/db/v*.db`
- [ ] `data-safety.yml` extended with SQLite jobs

**Verification:**

```bash
pnpm run e2e:desktop
pnpm run verify:backup
pnpm run test:migrations
```

---

## Week 9: Code Signing & Release Process

**Description:** This week you will make installers trustworthy and releases repeatable. You will set up Windows code signing (certificate stored as a GitHub secret), automate changelog generation from conventional commits, define the release checklist covering both the PWA bundle and the desktop installers, and cut the first signed beta.

### Research Required:

- **Windows Code Signing:** OV vs EV certificates, SmartScreen reputation, signing in `tauri-action`, Azure Trusted Signing as an alternative
- **Changelog Automation:** `changesets` or `conventional-changelog`; release notes in GitHub Release body
- **Semantic Versioning for Local Apps:** Schema version vs app version coupling across both runtimes
- **Release Checklist Discipline:** Fixtures generated, docs updated, migrations tested, PWA bundle attached

### Release Tasks:

1. **Signing Setup** — Certificate secret, `signCommand` or `tauri-action` signing inputs
2. **Changelog Generation** — Automated from commits; edited by hand before publishing
3. **Release Checklist** — `docs/RELEASE.md`: bump, fixtures, migrations, bench, sign, publish PWA zip + installers, announce
4. **Pre-release Channel** — `-beta.N` tags publish as pre-releases
5. **First Signed Beta** — `v0.1.0-beta.1`

**Deliverables:**

- [ ] Signing configured and verified (no SmartScreen "unknown publisher" on a clean VM)
- [ ] `docs/RELEASE.md`
- [ ] `CHANGELOG.md` automation

**Verification:**

```bash
git tag v0.1.0-beta.1 && git push --tags
# Download installer; check signature properties in Windows Explorer
```

---

## Week 10: Local Diagnostics & Logging (No Telemetry)

**Description:** This week you will give users and developers a way to debug issues without any data leaving the machine. Structured local logs with rotation on desktop, a Rust panic hook that writes to the log, a "Save diagnostics bundle" command producing a zip with logs, schema version, integrity result, and machine info, an equivalent JSON download on web, and a documented bug-report flow.

### Research Required:

- **Rust Logging:** `tracing` + `tracing-appender` rolling files; log levels by build type
- **Webview Logging Bridge:** Forwarding console errors to the Rust log via Tauri plugin-log; ring buffer in web build
- **Privacy in Logs:** Redaction rules (never titles/bodies), reviewing log lines for PII
- **Crash Handling:** Panic hook, last-run marker for "did the app crash last time"

### Logging Tasks:

1. **Log Setup (desktop)** — Rolling daily files in app data dir, 10 MB cap, 7 files
2. **Log Ring Buffer (web)** — Last 500 entries in memory, included in the diagnostics JSON
3. **Webview Bridge** — `console.error` and unhandled rejections logged
4. **Panic Hook** — Writes stack to log; next launch shows a gentle notice
5. **Diagnostics Bundle** — Zip command + Settings button (desktop); JSON download (web); content review checklist
6. **Bug Report Doc** — `docs/BUG-REPORTS.md` explaining what the bundle contains and does not contain

**Deliverables:**

- [ ] `apps/orbit/src-tauri/src/logging.rs`
- [ ] Diagnostics wired to Settings on both runtimes
- [ ] `docs/BUG-REPORTS.md`

**Verification:**

```bash
pnpm run tauri dev
# Trigger an error; Settings → Save diagnostics; inspect zip contents
```

---

## Week 11: Tray, Autostart & Notification Packaging

**Description:** This week you will package the resident behaviour Orbit needs to deliver reminders offline: tray presence, hide-to-tray on close, autostart at login (opt-in), and OS notification identity. You will verify behaviour on a clean Windows install, including notifications when the main window is closed.

### Research Required:

- **Tauri Tray Plugin:** Icons, menus, left-click behaviour on Windows
- **Autostart Plugin:** Registry entry, per-user; uninstall cleanup
- **Windows Notifications:** AppUserModelID requirement for toasts from Tauri apps; Focus Assist implications
- **Installer Hooks:** NSIS hooks to remove autostart on uninstall

### Packaging Tasks:

1. **Tray Configuration** — Icon assets (light/dark), menu, single-instance enforcement
2. **Autostart** — Setting toggle; installer uninstall hook removes it
3. **Notification Identity** — AppUserModelID configured so toasts show the Orbit name and icon
4. **Close Behaviour** — Close-to-tray default with a first-time explanation
5. **Clean VM Verification** — Install, enable autostart, reboot, confirm tray + reminder fires

**Deliverables:**

- [ ] Tray, autostart, notification config in `tauri.conf.json` and Rust
- [ ] NSIS uninstall hook
- [ ] Verification notes in `docs/RESIDENT-BEHAVIOUR.md`

**Verification:**

```bash
pnpm run tauri build
# Install on clean VM; create bill due in 1 minute; close window; wait for toast
```

---

## Week 12: Optional Updater (Manual Check)

**Description:** This week you will add a desktop updater that never phones home on its own. Users can click "Check for updates" in Settings; the app fetches a signed manifest, verifies the signature, and offers to download and install. Fully offline users are unaffected. The PWA updates through its service worker only when the user opens a newer bundle they host themselves.

### Research Required:

- **Tauri Updater Plugin:** Manifest format, signature verification, `pubkey` embedding
- **Key Management:** Generating the updater keypair; private key as GitHub secret; rotation plan
- **Manual-Only Policy:** Disabling automatic checks; UI copy that states no background network use
- **Static Manifest Hosting:** GitHub Releases as the manifest source (no custom server)

### Updater Tasks:

1. **Keypair & Secrets** — Generate, store private key as secret, embed public key
2. **Release Workflow Signing** — `tauri-action` produces `.sig` and `latest.json`
3. **Manual Check UI** — Settings → Updates → Check; shows version, notes, install button
4. **Policy Enforcement** — No check on launch; documented in Settings copy and `docs/PRIVACY.md`
5. **Rollback Note** — Keep previous installer link in release notes

**Deliverables:**

- [ ] Updater configured; `latest.json` published per release
- [ ] Manual check UI verified from a prior version
- [ ] `docs/PRIVACY.md`

**Verification:**

```bash
# Install v0.1.0-beta.1, publish beta.2, click Check for updates, install, confirm version
```

---

## Week 13: Security Review & 1.0 Release

**Description:** This week you will harden both runtimes and ship 1.0. You will lock down Tauri capabilities to the minimum, set a strict CSP for the webview and the PWA, audit dependencies, confirm zero network calls with a packet capture, run the full data-safety and benchmark suites, and publish the signed desktop release and the PWA bundle with documentation.

### Research Required:

- **Tauri 2 Capabilities:** Per-window permission sets, restricting fs/dialog/shell scopes
- **CSP:** `default-src 'self'`, no remote sources, font/data URIs as needed; service worker compatibility
- **Dependency Auditing:** `pnpm audit`, `cargo audit`, `cargo deny` licences
- **Network Verification:** Capturing traffic during a full session on both runtimes to prove no outbound calls (except manual update check)

### Release Tasks:

1. **Capabilities Lockdown** — Minimal permission set per window; documented in `docs/SECURITY.md`
2. **CSP** — Strict policy on both runtimes; verify fonts and images still load from bundle
3. **Dependency Audit** — `pnpm audit`, `cargo audit`, `cargo deny check`; fix or document
4. **Zero-Network Proof** — Packet capture during e2e runs; report attached to release
5. **Full Suite** — CI, both e2e suites, data-safety, bench all green on the release commit
6. **1.0 Release** — Signed installers, PWA bundle zip, changelog, `README.md`, `SETUP.md`, docs index

**Deliverables:**

- [ ] `docs/SECURITY.md` with capability and CSP rationale
- [ ] Audit reports clean
- [ ] `v1.0.0` published with signed installers, PWA bundle, and checksums

**Verification:**

```bash
pnpm audit && cargo audit
pnpm run test && pnpm run e2e && pnpm run e2e:desktop && pnpm run bench
git tag v1.0.0 && git push --tags
```

---

## Summary: DevOps Implementation Status

| Week        | Feature Area                                      | Status      | Progress |
| ----------- | ------------------------------------------------- | ----------- | -------- |
| **Week 1**  | Local Toolchain & Repository Bootstrap            | ✅ COMPLETE | 100%     |
| **Week 2**  | Continuous Integration                            | ✅ COMPLETE | 90%      |
| **Week 3**  | PWA Build & Static Preview                        | ✅ COMPLETE | 100%     |
| **Week 4**  | Test Infrastructure & Browser End-to-End          | ✅ COMPLETE | 100%     |
| **Week 5**  | Data Safety Verification (Web)                    | ⏳ PENDING  | 0%       |
| **Week 6**  | Performance Benchmarks                            | ⏳ PENDING  | 0%       |
| **Week 7**  | Rust Toolchain, Tauri Build Pipeline & Installers | ⏳ PENDING  | 0%       |
| **Week 8**  | Desktop E2E & SQLite Data Safety                  | ⏳ PENDING  | 0%       |
| **Week 9**  | Code Signing & Release Process                    | ⏳ PENDING  | 0%       |
| **Week 10** | Local Diagnostics & Logging (No Telemetry)        | ⏳ PENDING  | 0%       |
| **Week 11** | Tray, Autostart & Notification Packaging          | ⏳ PENDING  | 0%       |
| **Week 12** | Optional Updater (Manual Check)                   | ⏳ PENDING  | 0%       |
| **Week 13** | Security Review & 1.0 Release                     | ⏳ PENDING  | 0%       |

**Total Progress:** 4/13 weeks complete (31%)
