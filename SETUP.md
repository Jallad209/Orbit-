# Orbit — Development Setup (Windows)

Orbit is built as a web app and shipped as a desktop app. **Weeks 1–6 need only Node.** The Rust toolchain is added in week 7 when the Tauri shell arrives.

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
