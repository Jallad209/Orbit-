# Orbit

A personal operating system that turns goals, responsibilities, routines, commitments, and information into an actionable daily plan.

**Fully offline. No account. Your data is a file you own.**

Capture → Plan → Do → Review. One loop, one connected system.

## Status

Week 13 hardening is implemented and locally verified where automation can reach it. The
installed-Windows, fresh desktop-binary, manual accessibility, CI, and publication gates remain
open, so this is not yet a 1.0 release. Their exact status is in
[the 1.0 verification report](docs/testing/release-1.0/REPORT.md). The optional week-12 updater
was not selected. See the task tracks:

- [docs/ORBIT-SPEC.md](docs/ORBIT-SPEC.md) — product and technical spec
- [docs/BACKEND-TASKS.md](docs/BACKEND-TASKS.md) — core engine and local data layer
- [docs/FRONTEND-TASKS.md](docs/FRONTEND-TASKS.md) — interface
- [docs/DEVOPS-TASKS.md](docs/DEVOPS-TASKS.md) — builds, CI, releases

Feature behaviour and limits: [Daily reviews](docs/DAILY-REVIEWS.md), [Weekly review](docs/WEEKLY-REVIEW.md), [Insights](docs/INSIGHTS.md), [People and commitments](docs/PEOPLE-AND-COMMITMENTS.md), [Bills](docs/BILLS.md), [Notes](docs/NOTES.md), [Deep links](docs/DEEP-LINKS.md), [Resident behaviour (desktop)](docs/RESIDENT-BEHAVIOUR.md), [Accessibility audit](docs/A11Y-AUDIT.md), [Security](docs/SECURITY.md), [Privacy](docs/PRIVACY.md), [Release process](docs/RELEASE.md), [1.0 verification](docs/testing/release-1.0/REPORT.md), and [Hosting the PWA](docs/HOSTING.md).

## Quick start

See [SETUP.md](SETUP.md).

```bash
pnpm install
pnpm run dev
```

## Architecture in one paragraph

The React app never touches storage directly. It talks to a `Repository` interface from `@orbit/storage`, which has in-memory, IndexedDB, and (from week 7) SQLite adapters. All domain logic in `@orbit/core` is pure TypeScript over a state snapshot, so the planner, parser, rules, and insights are tested without a UI or a database. A `Platform` interface in the app is the only place runtime APIs are imported, which is what lets the same code run as an installable PWA and as a Tauri desktop app.
