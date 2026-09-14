# DevOps Team Tasks (13 Weeks)

**Tech Stack:** pnpm + GitHub Actions + Vitest + Playwright + Vite PWA + Lighthouse + Rust toolchain & Tauri CLI (from week 7) + tauri-driver/WebdriverIO + NSIS/MSI + Tauri Updater (manual check)
**Repository:** `C:\Orbit`
**Owned:** `.github/`, `scripts/`, `apps/orbit/src-tauri/tauri.conf.json` (build/security sections, from week 7), release process
**Current Status:** Weeks 1-11 ✅ COMPLETE (branch protection pending: needs `gh auth login` or the GitHub UI; week 11's installed-Windows pass is recorded as NOT RUN in `docs/RESIDENT-BEHAVIOUR.md`)

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

## Week 5: Data Safety Verification (Web) ✅ COMPLETE

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

**What was done:**

- `packages/storage/test/data-safety/roundtrip.test.ts`: seed → export → import into a fresh repository (replace) → export; the two exports are byte-identical, the report shows only creates, and soft-deleted rows survive; `ROUNDTRIP_SIZE` sets the task count (5,000 locally, 50,000 in CI); the IndexedDB variant runs a tenth of that through fake-indexeddb
- `migrations.test.ts`: for every `tests/fixtures/idb/v*.json` a Dexie database is built at exactly that version from `SCHEMA_VERSIONS`, filled, then opened with today's adapter; row counts per store must match, stores added later must be writable, and `indexedDbVersion()` must report the current version; every `tests/fixtures/export/v*.json` must import cleanly
- `scripts/make-fixture.ts` (`pnpm run make:fixture`, via tsx) writes the current-version fixtures from the seeded world; v1 fixtures were derived once and are never regenerated
- `data-safety.yml`: on every PR, nightly at 04:00 UTC, and on demand — job 1 runs the 50k round trip, the migration matrix, and fails if `make:fixture` would change a committed fixture; job 2 runs `data-safety.spec.ts` in Chromium
- `tests/e2e/playwright/data-safety.spec.ts`: five areas and four captures survive a reload and a second tab; with `navigator.storage.persist()` stubbed to refuse, the banner appears and "Export now" downloads a valid `orbit-export-YYYY-MM-DD.json` containing the data
- Root scripts `test:roundtrip`, `test:migrations`, `make:fixture`, `bench:planner`; `@types/node` added for core/storage tests; `tests/fixtures` excluded from Prettier

**Files created:**

- `.github/workflows/data-safety.yml` ✅
- `scripts/make-fixture.ts` ✅
- `tests/fixtures/export/{v1,v2}.json`, `tests/fixtures/idb/{v1,v2}.json` ✅
- `packages/storage/test/data-safety/{roundtrip,migrations}.test.ts`, `tests/e2e/playwright/data-safety.spec.ts` ✅

**Deliverables:**

- [x] `.github/workflows/data-safety.yml`
- [x] `scripts/make-fixture.ts`
- [x] `tests/fixtures/export/v*.json`

**Verification:**

```bash
pnpm run test:roundtrip
pnpm run test:migrations
```

---

## Week 6: Performance Benchmarks ✅ COMPLETE

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

**What was done:**

- `scripts/seed.ts` (`pnpm run seed -- --tasks 50000 --notes 10000 --days 365`): a realistic export with projects, milestones, sessions, blocks, day commitments, routines with instances, and an op log, written under `bench/data/` (git-ignored); the shapes come from `seedWorld` in core
- `scripts/bench.ts` (`pnpm run bench`): tinybench runs of planner (2k open tasks, budget 50 ms), search (title scan over 50k tasks, 30 ms, placeholder until week 10), insights (health + attention over a 50k world, 200 ms), recurrence (one year of routines, 20 ms), capture parsing (30 ms); every run fails on a blown budget or a mean more than `--tolerance` (25 %) slower than `bench/baseline.json`; `--update` rewrites the baseline; results go to `bench/results.json` and to the CI job summary
- Reference numbers on the development machine: planner 3.0 ms, search 2.4 ms, insights 84 ms, recurrence 3.9 ms, capture 1.9 ms
- `tests/e2e/playwright/startup.spec.ts`: seeds 7,464 records straight into the app's IndexedDB through the raw API (no test-only app code), then measures a cold navigation to an interactive Today screen: 614 ms locally against a 1.5 s budget (3 s on shared CI runners)
- `bench.yml`: on every push to main and on demand (with a tolerance input): engine job with the results artifact, startup job in Chromium; when runner hardware changes, download `bench-results` and commit it as the baseline
- Bundle baseline re-based to 264.6 KB gzip after `@dnd-kit` (the growth guard would otherwise trip at +20 %)

**Files created:**

- `scripts/seed.ts`, `scripts/bench.ts`, `bench/baseline.json` ✅
- `.github/workflows/bench.yml`, `tests/e2e/playwright/startup.spec.ts` ✅

**Deliverables:**

- [x] `scripts/seed.ts`, `scripts/bench.ts`, `bench/baseline.json`
- [x] `.github/workflows/bench.yml`

**Verification:**

```bash
pnpm run seed -- --tasks 50000
pnpm run bench
```

---

## Week 7: Rust Toolchain, Tauri Build Pipeline & Installers ✅ COMPLETE

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

**What was done:**

- `rust-toolchain.toml` (stable, rustfmt, clippy); `SETUP.md` section 5 covers rustup, Visual Studio Build Tools with the C++ workload **and the Windows 11 SDK**, WebView2, and why cargo must run outside Git Bash
- `ci.yml` gained a `rust` job on `windows-latest`: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo check`, with `Swatinem/rust-cache`
- `release.yml` on `v*` tags: `tauri-apps/tauri-action` builds NSIS and MSI installers, a draft release is created (pre-release when the tag carries a hyphen), `SHA256SUMS.txt` is attached, installer and binary sizes go to the job summary, and `scripts/check-binary-size.mjs` fails on more than 20 % growth over `bench/binary-baseline.json`
- `scripts/bump-version.ts` (`pnpm run bump -- 0.1.0-alpha.1 | patch | minor | major`) rewrites `package.json` (root and app), `tauri.conf.json`, and `Cargo.toml` together
- Release profile: `opt-level = "s"`, LTO, one codegen unit, stripped, `panic = "abort"`
- Verified locally after the Windows 11 SDK was installed: `cargo check`, `cargo fmt --check`, `cargo clippy -D warnings`, and `pnpm run tauri:build` all pass; the build produced the NSIS installer (2.2 MB), the MSI (2.8 MB), and `orbit.exe` (4.9 MB), recorded in `bench/binary-baseline.json`
- Install test: the built `orbit.exe` was launched on this machine; first run created `orbit.db` (WAL mode, `-wal` and `-shm` beside it) under `%APPDATA%app.orbit.desktopdata` and the settings file next to the app config
- Tagged `v0.1.0-alpha.1` after `pnpm run bump`; the Release workflow builds the installers on GitHub and opens a draft pre-release to publish

**Files created:**

- `rust-toolchain.toml`, `.github/workflows/ci.yml` (rust job), `.github/workflows/release.yml` ✅
- `scripts/bump-version.ts`, `scripts/check-binary-size.mjs` ✅
- `SETUP.md` §5 ✅

**Deliverables:**

- [x] `rust-toolchain.toml`, Rust job in `ci.yml`
- [x] `.github/workflows/release.yml`
- [x] `scripts/bump-version.ts`
- [x] First tagged pre-release `v0.1.0-alpha.1` with installers (draft on GitHub)

**Verification:**

```bash
rustc -V && cargo -V
pnpm run tauri build
git tag v0.1.0-alpha.1 && git push --tags
```

---

## Week 8: Desktop E2E & SQLite Data Safety ✅ COMPLETE

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

**What was done:**

- `scripts/make-fixture.ts` now also loads the versioned SQL dump into a real `tests/fixtures/db/v<N>.db` through `better-sqlite3` (rollback journal, not WAL, so the file stands alone); the bytes are reproducible run to run, so the "fixtures are current" diff in CI covers it. `.gitignore` keeps `*.db` out except this folder
- `packages/storage/test/data-safety/sqlite-migrations.test.ts`: the desktop twin of the IndexedDB matrix — for every `.db` fixture, copy it aside, check `user_version`, run the integrity check, migrate to today's schema, check again, and compare each table's row count with the INSERTs in the dump of that version; a store added after that version is usable straight away. Runs under `pnpm run test:migrations` alongside the IndexedDB matrix
- `scripts/verify-backup.ts` (`pnpm run verify:backup`, or `-- --db path` for a real file): seeds a database, copies it with SQLite's online backup API (`db.backup()`), restores the copy into a fresh path the way the desktop recovery does, and compares schema version, integrity, every table's row count, and a SHA-256 over each table's rows in id order plus the op log by seq; exits 1 on the first difference (checked against a byte-flipped file) and prints a one-line summary otherwise. Added to the round-trip job in `data-safety.yml`
- Corruption: a byte-flip test in `sqlite.test.ts` writes a 400-task database, flips the b-tree headers of three pages in the middle of the file, and asserts the integrity check reports the damage (`malformed` / `Page N …`) rather than "not a database" — the second branch of the startup recovery path. Plus a restart test: a session started on one connection is found running by the next
- Desktop e2e harness in `tests/e2e/tauri/`: `wdio.conf.ts` spawns `tauri-driver --native-driver <msedgedriver>` (waiting on its `/status` before opening the session), points the `tauri:options` capability at the release binary, switches to the main window (the session may start on the hidden quick-capture window), and gives every session a throwaway `ORBIT_DATA_DIR` and `WEBVIEW2_USER_DATA_FOLDER`. `commands/data_dir.rs` honours `ORBIT_DATA_DIR` (no settings read or written), so a run never touches the user's database. `specs/core-loop.spec.ts` ports the first core-loop scenario: first run → capture three items → file one into a project → everything still there after a reload, on SQLite this time
- `scripts/edge-driver.ts` (`pnpm run edge:driver`) reads the WebView2 runtime version from the registry and fetches the matching Edge WebDriver into the git-ignored `tests/e2e/tauri/.driver`; `pnpm run tauri:build:bin` builds the binary without installers; `pnpm run e2e:desktop` runs WebdriverIO. Run locally on WebView2 152.0.4191.66 with `tauri-driver` 2.0.6: both desktop tests pass, repeatedly
- `data-safety.yml` gained the `verify:backup` step and a `desktop` job on `windows-latest`: Rust toolchain and cargo cache, `tauri-driver` cached in `~/.cargo/bin`, the Edge Driver download step, `tauri:build:bin`, `e2e:desktop`
- `SETUP.md` §7 documents the desktop e2e prerequisites
- Seen on the way, left for the release work in week 9: the MSI bundler rejects the `-alpha.1` pre-release identifier (NSIS and the binary build fine), which is why the e2e builds with `--no-bundle`

**Files created:**

- `tests/fixtures/db/v1.db`, `packages/storage/test/data-safety/sqlite-migrations.test.ts` ✅
- `scripts/verify-backup.ts`, `scripts/edge-driver.ts` ✅
- `tests/e2e/tauri/{wdio.conf.ts,tsconfig.json,specs/core-loop.spec.ts}` ✅
- `.github/workflows/data-safety.yml` (verify:backup step, `desktop` job), `SETUP.md` §7 ✅

**Deliverables:**

- [x] `tests/e2e/tauri/*`
- [x] `scripts/verify-backup.ts`
- [x] `tests/fixtures/db/v*.db`
- [x] `data-safety.yml` extended with SQLite jobs

**Verification:**

```bash
pnpm run test:migrations
pnpm run verify:backup
pnpm run edge:driver && pnpm run tauri:build:bin && pnpm run e2e:desktop   # PowerShell
```

---

## Week 9: Code Signing & Release Process ✅ COMPLETE (signing skipped by decision)

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

**What was done:**

- **Signing route: Azure Trusted Signing** (about $10 a month, no hardware token, works in CI, earns SmartScreen reputation over time; an OV certificate now ships on a token, which is awkward in CI, and self-signed does nothing for SmartScreen). `release.yml` signs when the `AZURE_CLIENT_ID` secret exists: installs `trusted-signing-cli` (cached in `~/.cargo/bin`), writes a `--config` overlay with `bundle.windows.signCommand` built from `AZURE_ENDPOINT` / `AZURE_ACCOUNT` / `AZURE_PROFILE`, passes `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` to `tauri-action`, and afterwards runs `Get-AuthenticodeSignature` over `orbit.exe` and every installer, failing the job unless each is `Valid`. Local builds never sign
- **Signing skipped by decision:** Orbit is for its author and people who trust them, so a certificate (an Azure account, a monthly fee, identity documents) is not worth it yet. Builds stay unsigned, SmartScreen's one-time warning is documented in the release notes, and the workflow keeps the signing path ready behind the `AZURE_*` secrets should that change (`docs/RELEASE.md` § If signing is ever wanted)
- **Changelog:** `git-cliff` (npm package, no extra toolchain) with `cliff.toml` grouping by Conventional Commit type (feat → Added, fix → Fixed, perf, refactor → Changed, docs, chore/build → Maintenance; test / ci / style / release commits skipped). `scripts/changelog.ts`: `pnpm run changelog` prints what is unreleased, `pnpm run changelog:release -- v<tag>` inserts the tag's section at the top of `CHANGELOG.md` keeping every hand-edited section below it. `CHANGELOG.md` written by hand for `0.1.0-alpha.1` and the unreleased weeks 8–9. In `release.yml` the section for the current tag (`git-cliff --current`) plus install notes and the checksum pointer become the draft release body
- **`docs/RELEASE.md`:** the channels table (`-alpha.N` unsigned, `-beta.N` signed pre-release, `vX.Y.Z` stable with MSI), the checklist in order — gate, fixtures and migrations on a schema bump, backup verify and round trip, bench, desktop e2e, docs, bump, changelog, commit, tag, watch the workflow, verify the draft (signature on a clean machine, install, PWA, checksums), publish, announce — the one-time signing setup, and what to do when a run fails
- **PWA zip** attached automatically (`orbit-pwa-<tag>.zip` from the `dist` the shell build produced) and listed in `SHA256SUMS.txt` with the installers
- **Pre-release channel:** any hyphenated tag is a pre-release and ships NSIS only — the MSI's version field cannot carry `-alpha.N` / `-beta.N`, which is what broke `tauri:build` in week 8; stable tags ship NSIS + MSI. `-alpha.N` documented as the unsigned channel, `-beta.N` as the signed one
- **First beta:** `v0.1.0-alpha.2` cut unsigned (weeks 8–9), which also exercises the changelog, PWA zip, and NSIS-only paths of the new workflow; the `-beta.N` channel is "ready for the trusted circle", not "signed"
- Desktop e2e gained `specs/reminders.spec.ts`: a 3-day bill rule and a bill due tomorrow are queued by the web side and fired by the Rust scheduler within a poll, checked by reading the SQLite file through a second connection while the app runs

**Files created:**

- `cliff.toml`, `scripts/changelog.ts`, `CHANGELOG.md` ✅
- `docs/RELEASE.md` ✅
- `.github/workflows/release.yml` (signing, notes, PWA zip, NSIS-only pre-releases) ✅
- `tests/e2e/tauri/{session.ts,specs/reminders.spec.ts}` ✅

**Deliverables:**

- [x] ~~Signing configured and verified (no SmartScreen "unknown publisher" on a clean VM)~~ — **skipped by decision** (author and trusted users only); the workflow signs and verifies the moment the `AZURE_*` secrets exist
- [x] `docs/RELEASE.md`
- [x] `CHANGELOG.md` automation

**Verification:**

```bash
pnpm run changelog                         # what is unreleased
pnpm run changelog:release -- v0.1.0-beta.1
git tag v0.1.0-beta.1 && git push --tags
# Download the installer on a clean machine; SmartScreen warns once (unsigned), install completes
```

---

## Week 10: Local Diagnostics & Logging (No Telemetry) ✅ COMPLETE

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

**What was done:**

- **`logging.rs`** (desktop): one JSON object per line — `ts`, `level`, `subsystem`, `op`, `fields` — in `<app data dir>/logs/orbit-<date>.<nnn>.log`; a new file each day and whenever one reaches 10 MB, the seven newest kept, a restart appends to the day's newest file when it has room. `debug` in development, `info` in release. Redaction is enforced by the writer, not by care: every string field has quoted segments replaced by `…` and is cut to 80 characters, nested values are dropped, keys are trimmed. Instrumented: process start/exit, database open (and failures), data-folder relocation, backup restore, reminder delivery counts and notification failures, webview events, and the diagnostics export itself — never a path, a title, or SQL
- **Panic hook and last-run marker**: `install_panic_hook` writes a redacted crash record (`file:line`, message ≤ 200 chars) to `last-run.json` and the log, guarded against re-entry, then hands over to the default hook. `begin_run` reads the previous marker (crashed if it never ended cleanly) and claims the run; `RunEvent::Exit` flips it clean. `diagnostics_last_run` returns `{ crashedLastTime, startedAt, crash }`; the app shows one gentle toast per crashed run and Settings → Data → Diagnostics states it
- **Web ring buffer** (`lib/diagnostics.ts`): the last 500 events in memory. `installDiagnostics()` (in `main.tsx`) wraps `console.error` (the original still prints), `window.onerror`, and `unhandledrejection`; an event is a timestamp, level, source, the error class or operation name, the route with ids replaced, the script path without query or origin plus line/column, an FNV-1a digest of the message (grouping without the text), and small numbers or flags — never the message. On desktop `DiagnosticsBridge` forwards each event to the shell log through `diagnostics_log`, which clips the kind and sanitizes the fields again
- **Diagnostics bundle**: `buildDiagnosticsReport` (versions, build, capabilities, browser family and OS family — never the raw user agent — language, time zone, schema versions, storage status, live/total row counts per store, search backend, integrity ok/message count/FTS5, recovery flag, last run, events). Web: a JSON download through `platform.exportFile`. Desktop: `diagnostics_export` writes a zip through a save dialog — `report.json` (the report plus shell version, Tauri version, OS, arch, log-file count, the marker), `last-run.json`, and `logs/*` — and returns the path and file list. `DiagnosticsSettings` on Settings → Data: what is inside, what never is, the previous run's outcome, the button with busy/saved/error states, and a link to the bug-report guide. The plan's stop condition holds: the button ships because the redaction is proven, not assumed
- **`docs/BUG-REPORTS.md`**: what to send, the contents of `report.json` and the desktop extras, the never-list, how the redaction is enforced, "read it before you share it", and what the crash notice means
- Tests: 7 Rust (redaction and field sanitizing, rotation by size and by day with retention and same-day reopen, JSON lines above the level, the marker across clean / crashed / killed runs, the bundle's entries with a marker string proven absent, a bundle without a log folder) and 12 web (buffer kinds/positions/digests with sensitive strings absent across every channel, the 500 cap and subscribers, route/script sanitizing, coarse user agent; report contents with marker records in every store proven absent, web download and desktop zip paths, the settings card's saved and failed states, the last-run line)

**Files created:**

- `apps/orbit/src-tauri/src/{logging,time}.rs`, `apps/orbit/src-tauri/src/commands/diagnostics.rs` ✅
- `apps/orbit/src/lib/diagnostics.ts`, `apps/orbit/src/lib/diagnostics.test.ts` ✅
- `apps/orbit/src/features/settings/{DiagnosticsSettings,DiagnosticsBridge}.tsx`, `diagnosticsService.ts`, `DiagnosticsSettings.test.tsx` ✅
- `docs/BUG-REPORTS.md` ✅

**Deliverables:**

- [x] `apps/orbit/src-tauri/src/logging.rs`
- [x] Diagnostics wired to Settings on both runtimes
- [x] `docs/BUG-REPORTS.md`

**Verification:**

```bash
cargo test --manifest-path apps/orbit/src-tauri/Cargo.toml logging diagnostics
pnpm exec vitest run --project orbit diagnostics
pnpm run tauri dev
# Settings → Data → Save diagnostics bundle; open the zip: report.json, last-run.json, logs/
```

---

## Week 11: Tray, Autostart & Notification Packaging ✅ COMPLETE (installed-VM pass pending)

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

**What was done:**

- **Lifecycle coordinator** (`src-tauri/src/resident.rs`): launch reason from an allowlist of arguments (`--background`, `--capture`; anything else is a manual launch), phases booting → ready → degraded / quitting, the main window created hidden and shown by policy, a readiness handshake only the main window can complete and only for the open database generation (queued tray navigation flushes then), the close policy (blocked until the legacy preference settled, explanation first, hide, or quit), and the orderly shutdown: refuse new independent writes, stop the scheduler with a bounded join, let an owned transaction settle (10 s), close the data file, save window state, mark the run clean, exit. A quit that cannot finish leaves the app visible with the error; only an orderly shutdown marks the run clean. Window state restores size, position, and maximized — never visibility
- **Single instance** (`tauri-plugin-single-instance`, registered first): a second manual launch activates the existing window, `--capture` opens the capture window, a duplicate login launch is ignored; no second database, scheduler, or crash marker. Skipped under `ORBIT_DATA_DIR` so a test can never forward to the user's running Orbit
- **Tray** (`tray.rs`, `tauri` `tray-icon`): Open Orbit, Quick Capture (Ctrl+Shift+Space), Plan my day (Today in proposal mode, nothing accepted), separator, Quit Orbit; left click activates main, right click opens the menu; the bundled icon; creation failure leaves main reachable, turns close-to-tray off for the run, and Settings says so
- **Native preferences** (`prefs.rs`, `desktop-preferences.json` beside `settings.json`, never in the data file or an export): closeToTray (default on), closeExplanationSeen, autostart, legacyCloseMigrated; the main window transfers the raw week-10 `orbit-close-to-tray` localStorage value once ("0" stays off, "1" stays on, missing adopts the default) and a close is held until it has
- **Opt-in autostart** (`autostart.rs`, `tauri-plugin-autostart` with `Orbit` / `--background`): current user only; enable/disable from Settings → Desktop; the OS registration is read back after every change and whenever the section opens; a failure shows the real state and the error; an enabled registration is refreshed to the current executable at startup; `ORBIT_AUTOSTART_FAKE` swaps the registry for a file in tests
- **Scheduler** (`scheduler.rs`): waits on a channel instead of sleeping (wake on readiness, resume, and after the frontend writes rows; stop with a 5 s join); ticks are skipped until the main window acknowledged the current generation, so a restore or relocation (both bump the generation now) never delivers from a file the frontend has not reconciled
- **Installer** (`src-tauri/windows/hooks.nsh`, wired through `bundle.windows.nsis.installerHooks`): after install, an existing `Run\Orbit` value that names `Orbit.exe` is rewritten to the executable just installed; after a user uninstall (not the in-place uninstall an upgrade performs), the value is deleted only if it points at this installation, plus its StartupApproved entry. The Run key, data folder, exports, backups, and preferences are never touched. NSIS only — MSI cleanup is an explicit stable-release gate
- **Notification identity**: identifier `app.orbit.desktop`, product name `Orbit`; an installed build's shortcut carries the identity, a development run under PowerShell does not
- **Test isolation**: the desktop harness sets `ORBIT_DATA_DIR`, `WEBVIEW2_USER_DATA_FOLDER`, and `ORBIT_AUTOSTART_FAKE`; under `ORBIT_DATA_DIR` preferences, logs, and the crash marker live beside the throwaway data folder, and neither single instance nor window state is registered. Desktop e2e: `resident.spec.ts` (readiness for the open generation and a refused stale generation, tray present, preferences resolved, first-close explanation → hide on acknowledge, later closes hide at once, Open restores, opt-in autostart with read-back against the fake), `zz-resident-quit.spec.ts` (Quit ends in order and the marker is clean), `reminders.spec.ts` (rows prepared ahead with date-stable wording and delivered natively). Rust unit tests: launch allowlist, close-policy matrix, tray routing, preference transfer, shutdown refusing new transactions while an owned one finishes
- **Installed Windows pass**: NOT RUN — no clean VM or disposable account was available in this pass. The scenarios (install → opt in → reboot → hidden reminder → sleep/resume → upgrade → disable → uninstall, notification identity, Focus Assist, duplicate launch against the real single-instance registration, forced termination) are listed with their status in `docs/RESIDENT-BEHAVIOUR.md`; resident delivery is not marked verified on an installed build until they pass

**Files created:**

- `apps/orbit/src-tauri/src/{resident,tray,prefs,autostart}.rs`, `apps/orbit/src-tauri/windows/hooks.nsh` ✅
- `tests/e2e/tauri/specs/{resident,zz-resident-quit}.spec.ts` ✅
- `docs/RESIDENT-BEHAVIOUR.md` ✅

**Deliverables:**

- [x] Tray, autostart, notification config in `tauri.conf.json` and Rust
- [x] NSIS uninstall hook
- [x] Verification notes in `docs/RESIDENT-BEHAVIOUR.md` (installed-VM scenarios recorded as NOT RUN)

**Verification:**

```bash
cargo test --manifest-path apps/orbit/src-tauri/Cargo.toml
pnpm run tauri:build:bin && pnpm run e2e:desktop
pnpm --filter orbit exec tauri build --bundles nsis   # then the clean-VM procedure in docs/RESIDENT-BEHAVIOUR.md
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
| **Week 5**  | Data Safety Verification (Web)                    | ✅ COMPLETE | 100%     |
| **Week 6**  | Performance Benchmarks                            | ✅ COMPLETE | 100%     |
| **Week 7**  | Rust Toolchain, Tauri Build Pipeline & Installers | ✅ COMPLETE | 100%     |
| **Week 8**  | Desktop E2E & SQLite Data Safety                  | ✅ COMPLETE | 100%     |
| **Week 9**  | Code Signing & Release Process                    | ✅ COMPLETE | 100%     |
| **Week 10** | Local Diagnostics & Logging (No Telemetry)        | ✅ COMPLETE | 100%     |
| **Week 11** | Tray, Autostart & Notification Packaging          | ✅ COMPLETE | 100%     |
| **Week 12** | Optional Updater (Manual Check)                   | ⏳ PENDING  | 0%       |
| **Week 13** | Security Review & 1.0 Release                     | ⏳ PENDING  | 0%       |

**Total Progress:** 11/13 weeks complete (85%)
