# Orbit — Product & Technical Spec (Offline-First, Web-First Build)

**Tagline:** A personal operating system that turns goals, responsibilities, routines, commitments, and information into an actionable daily plan. Fully offline. No account. Your data is a file you own.

**Repository:** `C:\Orbit`
**Team Docs:** `docs/FRONTEND-TASKS.md`, `docs/BACKEND-TASKS.md`, `docs/DEVOPS-TASKS.md` (13 weeks each, aligned by week)

---

## 1. Product Principles

1. **One loop, not nine features.** Capture → Plan → Do → Review. Every screen serves one step of the loop.
2. **Offline is the product.** No server, no telemetry, no subscription. Works on a plane. Instant everywhere.
3. **Explainable, not magical.** Every plan item shows why it was chosen and what was left out.
4. **Misclassification costs one keystroke.** Capture never blocks on a correct guess.
5. **Data is portable.** On desktop, a single SQLite file in a user-chosen folder. Everywhere, one-click export to JSON and Markdown. Automatic dated backups on desktop.
6. **Engine is pure.** Planner, parser, recurrence, rules, and insights are pure functions over a state snapshot. Testable without a UI or a database.

## 2. Build Strategy: Web App Architecture, Desktop Delivery

Orbit is **built as a web app and shipped as a desktop app**. The React application never touches storage directly; it talks to a `Repository` interface. That makes the runtime a deployment detail:

| Phase         | Runtime                                    | Storage                                     | Why                                                                              |
| ------------- | ------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------- |
| Weeks 1–6     | Plain browser (Vite dev server, PWA build) | IndexedDB adapter (Dexie)                   | Fastest iteration, no Rust toolchain, runs on phone from day one                 |
| Week 7 onward | Tauri 2 desktop shell **and** PWA          | SQLite adapter on desktop, IndexedDB on web | Reminders while closed, data as a file, tray, global capture hotkey, FTS5 search |

Desktop is required for three things a browser cannot do offline: fire reminders when the window is closed, keep the data as a real file in a folder the user chooses, and offer a system-wide quick-capture hotkey. Everything else runs identically in both.

## 3. What Offline Forces

| Concern                  | Decision                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| NL classification        | Deterministic grammar-based parser. Local model can plug in later behind the same `Classifier` interface.                                |
| Reminders                | Desktop only: Tauri tray + OS notifications. Web build shows reminders only while open (documented).                                     |
| Cross-device             | v1 is single-device per runtime. Desktop data file is portable. Web ↔ desktop moves via JSON export/import. Later: operation-log merge.  |
| Browser storage eviction | Web build requests persistent storage (`navigator.storage.persist()`), warns if denied, and nags to export. Desktop is the durable home. |
| Backups                  | Desktop: rotating dated copies + integrity check on startup. Web: export reminders.                                                      |
| Fonts/assets             | Everything bundled. No CDN, no Google Fonts.                                                                                             |
| Search                   | MiniSearch in-process index on both runtimes; SQLite FTS5 on desktop when the bundled build has it.                                      |

## 4. Tech Stack

| Layer                         | Choice                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI                            | React 18 + Vite + TypeScript (strict) + Tailwind CSS + Radix primitives + Framer Motion                                                                       |
| State                         | Zustand (UI state) + repository-backed queries (domain state)                                                                                                 |
| Domain / engine               | `packages/core` — pure TypeScript, Zod schemas, Vitest                                                                                                        |
| Storage                       | `packages/storage` — `Repository` interface, `InMemoryRepository` (tests), `IndexedDbRepository` (web, Dexie), `SqliteRepository` (desktop, Tauri SQL plugin) |
| Web runtime                   | Vite PWA plugin (service worker, manifest), static hosting or local preview                                                                                   |
| Desktop runtime (from week 7) | Tauri 2 (Rust) — Windows first, macOS/Linux builds later                                                                                                      |
| Search                        | MiniSearch (both) → FTS5 (desktop)                                                                                                                            |
| Testing                       | Vitest (unit), Testing Library (components), Playwright (web e2e), tauri-driver + WebdriverIO (desktop e2e)                                                   |
| Tooling                       | pnpm workspaces, ESLint, Prettier, Husky + lint-staged, GitHub Actions                                                                                        |

## 5. Repository Layout

```
C:\Orbit
├── apps/
│   └── orbit/                # The one React app; web build + (from week 7) Tauri shell
│       ├── src/              # screens, components, stores, platform adapters
│       ├── public/           # manifest, icons, bundled fonts
│       └── src-tauri/        # (week 7+) Rust shell: SQL plugin, notifications, tray, fs
├── packages/
│   ├── core/                 # Domain types, Zod schemas, parser, planner, recurrence, rules, insights
│   └── storage/              # Repository interface, memory / indexeddb / sqlite adapters, export/import, search
├── docs/
├── scripts/                  # seed, benchmark, backup-verify
└── tests/                    # e2e (playwright/, tauri/)
```

`apps/orbit/src/platform/` holds the runtime seam: `platform.web.ts` and `platform.desktop.ts` implement one `Platform` interface (storage factory, notifications, file dialogs, global hotkey, tray). The rest of the UI reads `platform.capabilities` and never imports Tauri APIs directly.

## 6. Data Model (normalized)

All records: `id: uuid`, `createdAt`, `updatedAt`, `deletedAt?` (soft delete).

| Entity              | Key fields                                                                                                       | Canonical parent      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------- |
| **Area**            | name, color, weeklyHoursTarget                                                                                   | —                     |
| **Goal**            | title, areaId, importance (1–5), targetDate?, status                                                             | Area                  |
| **Project**         | title, goalId?, areaId, outcome, deadline?, status, nextActionTaskId?                                            | Goal (or Area)        |
| **Milestone**       | projectId, title, done, order                                                                                    | Project               |
| **Task**            | title, projectId?, areaId?, status, priority, estimateMin, actualMin, dueAt?, energy (low/med/high), dependsOn[] | Project (or Area)     |
| **Event**           | title, startAt, endAt, source (manual/import), locked                                                            | —                     |
| **Routine**         | title, recurrence (RRULE-like), durationMin, energy, preferredWindow, areaId                                     | Area                  |
| **RoutineInstance** | routineId, date, status (planned/done/skipped)                                                                   | Routine               |
| **Note**            | title, body (markdown), projectId?, areaId?                                                                      | Project (or Area)     |
| **Person**          | name, contact?, lastContactAt                                                                                    | —                     |
| **Commitment**      | personId, text, dueAt?, status, direction (owed-by-me/owed-to-me)                                                | Person                |
| **Bill**            | title, amount, dueAt, recurrence?, paid                                                                          | — (v1 expense = bill) |
| **Block**           | date, startMin, endMin, taskId? / routineInstanceId? / eventId?, locked, source (planner/manual)                 | —                     |
| **DayCommitment**   | date, acceptedTaskIds[], energy, acceptedAt                                                                      | —                     |
| **Session**         | taskId, startAt, endAt                                                                                           | Task                  |
| **Rule**            | type (constraint/recurring/rollover/reminder), config (JSON), enabled                                            | —                     |
| **Link**            | fromType, fromId, toType, toId, linkType                                                                         | — (soft links)        |
| **InsightState**    | insightKey, snoozedUntil?, dismissedAt?                                                                          | —                     |
| **OpLog**           | seq, entity, entityId, op (create/update/delete), patch, at                                                      | append-only           |

## 7. Engine Contracts (packages/core)

```ts
parseCapture(text: string, now: Date): CaptureResult        // { type, fields, confidence, alternatives }
planDay(state: Snapshot, date: LocalDate, settings: PlanSettings): PlanProposal
   // { blocks, commitment, explanations: Record<taskId, Why>, leftOut: Array<{taskId, reason}> }
recalculateDay(state, date, changedBlock): PlanProposal     // respects locked blocks
expandRecurrence(routine, range): RoutineInstance[]
evaluateRules(state, date): RuleEffect[]
computeInsights(state, range): Insight[]                     // each with evidence[] and threshold
computeProjectHealth(project, state): ProjectHealth          // progress %, noNextAction, stale, blocked
```

Planner order: **constraints first** (working window, locked blocks, events, rest boundaries, rules) → **score** (deadline pressure × goal importance × staleness × dependency readiness × energy match) → **greedy fill** by fit → **explain**.

## 8. Screens

| Route                                                  | Purpose                                                                                                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/today`                                               | Home. Main focus, at-risk, timeline, commitment list, insights strip. Answers: what matters, what next, what is at risk, where is time going, what is neglected. |
| `/inbox`                                               | Universal capture + triage                                                                                                                                       |
| `/areas`, `/goals`, `/projects`, `/projects/:id`       | Structure + project detail (outcome, milestones, next action, linked notes/people/bills)                                                                         |
| `/timeline`                                            | Day view (drag, resize, lock); list variant on narrow screens                                                                                                    |
| `/review/morning`, `/review/evening`, `/review/weekly` | Guided flows                                                                                                                                                     |
| `/people`, `/bills`, `/notes`                          | Thin lists                                                                                                                                                       |
| `/settings`                                            | Working window, rest boundaries, rules, data (folder on desktop / export on web), backups                                                                        |
| Command palette (`Ctrl+K`)                             | Commands + global search                                                                                                                                         |

## 9. Design Tokens

| Token         | Value                    | Role                                               |
| ------------- | ------------------------ | -------------------------------------------------- |
| `--nav`       | `#1C1B1A` charcoal       | Navigation rail / palette background               |
| `--surface`   | `#F5F1EA` warm neutral   | Workspace                                          |
| `--surface-2` | `#EDE7DD`                | Cards, wells                                       |
| `--ink`       | `#1A1917`                | Text                                               |
| `--lime`      | `#C6F135`                | Action, "now", primary buttons (dark text on lime) |
| `--gold`      | `#D4A93A`                | Goals, importance, milestones                      |
| `--danger`    | `#C43D2E`                | Overdue, at risk                                   |
| Type          | Inter Variable (bundled) | Display 28/32, H1 22, body 15, mono for times      |

Motion: 120–180ms ease-out for state changes; no decorative animation.

## 10. Phase → Week Mapping

| Phase                             | Weeks | Outcome                                                                    |
| --------------------------------- | ----- | -------------------------------------------------------------------------- |
| 1. Data layer (web)               | 1–2   | Schemas, memory + IndexedDB repositories, op log, export/import, PWA shell |
| 2. Capture & structure            | 3–4   | Parser, inbox, areas/goals/projects/tasks, links                           |
| 3. Plan & do                      | 5–6   | Planner, Today screen, timeline with lock + recalc, recurrence             |
| 4. Desktop shell                  | 7     | Tauri, SQLite, data folder, import from web, quick capture, installers     |
| 5. Review & rules                 | 8–9   | Morning/evening, actuals, rules, reminders via Rust scheduler              |
| 6. Palette, search, insights      | 10–11 | Command palette, search, first four insights                               |
| 7. Weekly review, people, release | 12–13 | Weekly flow, follow-ups, tray, hardening, 1.0                              |
