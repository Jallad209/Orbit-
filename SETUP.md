# Orbit — Development Setup (Windows)

Orbit is built as a web app and shipped as a desktop app. **The web app needs only Node.** The desktop shell (week 7 onwards) also needs Rust and the Windows C++ toolchain; see section 5.

## 1. Install the toolchain

| Tool    | Version                    | Check           |
| ------- | -------------------------- | --------------- |
| Node.js | 20 LTS or newer (24 works) | `node -v`       |
| pnpm    | 9.x                        | `pnpm -v`       |
| Git     | any recent                 | `git --version` |

Install pnpm if missing:

```bash
npm i -g pnpm@9.15.9
```

## 2. Clone and install

```bash
git clone <your-remote> C:\Orbit
cd C:\Orbit
pnpm install
```

`pnpm install` also runs `husky`, which installs the pre-commit and commit-msg hooks.

## 3. Verify

```bash
pnpm run type-check
pnpm run lint
pnpm run test
pnpm run dev
```

`pnpm run dev` starts Vite on http://localhost:5173. Open it, install nothing, and press `g` then `i` to jump to the inbox.

## 4. Repository layout

```
apps/orbit/        React app (web build now; Tauri shell added in week 7)
packages/core/     Pure domain engine: schemas, parser, planner, rules, insights
packages/storage/  Repository interface + memory / indexeddb / sqlite adapters
docs/              Spec and the three task tracks
```

## 5. Conventions

- **Commits** follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:` …). The commit-msg hook rejects anything else.
- **Pre-commit** runs ESLint and Prettier on staged files.
- **Tests** live next to code (`*.test.ts`) or in `test/`. Run one project with `pnpm vitest run --project core`.
- **No network** in the app. Fonts and assets are bundled. Nothing may import Tauri outside `apps/orbit/src/platform/`.

## 6. Week 7 (desktop) prerequisites — not needed yet

- Rust stable via rustup
- Microsoft C++ Build Tools (Desktop development with C++)
- WebView2 runtime (preinstalled on Windows 11)
- `pnpm add -Dw @tauri-apps/cli`

## 5. Desktop shell (Tauri) — Windows

Needed only to run or build the desktop app (`pnpm run tauri:dev`, `pnpm run tauri:build`). CI builds the installers on GitHub's Windows runners, so the web app and every test run without any of this.

| Tool                      | How to get it                                                                                                                                                                                            | Check                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Rust (stable, MSVC)       | https://rustup.rs — the version comes from `rust-toolchain.toml`                                                                                                                                         | `rustc -V && cargo -V`                                                                                        |
| Visual Studio Build Tools | https://visualstudio.microsoft.com/visual-cpp-build-tools/ → workload **Desktop development with C++**. Make sure the individual component **Windows 11 SDK** is ticked; the compiler alone cannot link. | `vswhere -products * -requires Microsoft.VisualStudio.Component.Windows11SDK.26100` prints a path             |
| WebView2 runtime          | Included in Windows 11 and recent Windows 10; otherwise the Evergreen installer from Microsoft                                                                                                           | `Get-ItemProperty 'HKLM:SOFTWAREWOW6432NodeMicrosoftEdgeUpdateClients{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'` |
| Tauri CLI                 | already a dev dependency (`@tauri-apps/cli`)                                                                                                                                                             | `pnpm exec tauri --version`                                                                                   |

Then:

```bash
pnpm run tauri:dev      # Vite + the Rust shell with hot reload
pnpm run tauri:build    # NSIS and MSI installers under apps/orbit/src-tauri/target/release/bundle
```

Run cargo from PowerShell or cmd, not Git Bash: Git's `usr/bin` carries a GNU `link.exe` that shadows the MSVC linker.

Where the data goes: first run uses `%APPDATA%app.orbit.desktopdataorbit.db` (WAL mode, so `orbit.db-wal` and `orbit.db-shm` sit next to it). Change the folder from Settings → Data; Orbit restarts on the new location. The chosen folder is remembered in `%APPDATA%app.orbit.desktopsettings.json`.

Release: `pnpm run bump -- 0.1.0-alpha.1`, commit, `git tag v0.1.0-alpha.1 && git push --tags`. The Release workflow builds the installers, attaches them with a SHA-256 list, and creates a draft release to publish.

## 7. Desktop end-to-end tests (Windows)

`pnpm run e2e:desktop` drives the real release build through WebDriver: WebdriverIO → `tauri-driver` → Microsoft Edge WebDriver → Orbit's WebView2 window. Every run gets a throwaway data folder (`ORBIT_DATA_DIR`) and WebView2 profile (`WEBVIEW2_USER_DATA_FOLDER`), so it never touches your own database or settings. The same job runs on GitHub's Windows runner in `data-safety.yml`.

| Step                                  | Command (PowerShell)                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| tauri-driver (once)                   | `cargo install tauri-driver --locked`                                         |
| Edge WebDriver matching your WebView2 | `pnpm run edge:driver` (detects the runtime version; downloads once)          |
| Release binary                        | `pnpm run tauri:build:bin` (binary only; `tauri:build` also makes installers) |
| Run                                   | `pnpm run e2e:desktop`                                                        |

The harness lives in `tests/e2e/tauri/` (`wdio.conf.ts` plus `specs/`). After a WebView2 update, run `pnpm run edge:driver` again; a version mismatch fails at session start with an Edge Driver message naming both versions.
