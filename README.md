# Orbit

A personal operating system that turns goals, responsibilities, routines, commitments, and information into an actionable daily plan.

**Fully offline. No account. Your data is a file you own.**

Capture → Plan → Do → Review. One loop, one connected system.

## Status

Week 1 of 13. See the task tracks:

- [docs/ORBIT-SPEC.md](docs/ORBIT-SPEC.md) — product and technical spec
- [docs/BACKEND-TASKS.md](docs/BACKEND-TASKS.md) — core engine and local data layer
- [docs/FRONTEND-TASKS.md](docs/FRONTEND-TASKS.md) — interface
- [docs/DEVOPS-TASKS.md](docs/DEVOPS-TASKS.md) — builds, CI, releases

## Quick start

See [SETUP.md](SETUP.md).

```bash
pnpm install
pnpm run dev
```

## Architecture in one paragraph

The React app never touches storage directly. It talks to a `Repository` interface from `@orbit/storage`, which has in-memory, IndexedDB, and (from week 7) SQLite adapters. All domain logic in `@orbit/core` is pure TypeScript over a state snapshot, so the planner, parser, rules, and insights are tested without a UI or a database. A `Platform` interface in the app is the only place runtime APIs are imported, which is what lets the same code run as an installable PWA and as a Tauri desktop app.
