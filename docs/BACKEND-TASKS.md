# Backend Team Tasks (13 Weeks) — Core Engine & Local Data Layer

**Tech Stack:** TypeScript (strict) + Zod + Vitest + Dexie (IndexedDB) + SQLite (Tauri SQL plugin, from week 7) + MiniSearch / FTS5 + Tauri 2 Rust commands (from week 7)
**Repository:** `C:\Orbit`
**Packages Owned:** `packages/core`, `packages/storage`, `apps/orbit/src-tauri` (from week 7)
**Current Status:** Weeks 1-4 ✅ COMPLETE

> In Orbit there is no server. "Backend" means the pure domain engine (`packages/core`), the storage layer (`packages/storage`), and, from week 7, the Rust shell commands. Weeks 1–6 run entirely in the browser against IndexedDB. Everything here must run with the network cable unplugged.

---

## Week 1: Monorepo, Schemas & In-Memory Repository ✅ COMPLETE

**Description:** This week establishes the foundation for all domain logic. You will set up the pnpm workspace, create `packages/core` with Zod schemas for every entity in `ORBIT-SPEC.md` §6, define the `Repository` interface, and implement an `InMemoryRepository` used by every engine test. By the end of the week the whole data model exists as types and validators, and the storage contract is fixed so the frontend can build against it immediately.

### Research Required:

- **pnpm Workspaces:** Workspace protocol, shared tsconfig, building packages consumed by a Vite app
- **Zod Schemas as Source of Truth:** `z.infer`, discriminated unions for Rule types, branded UUID type
- **Repository Pattern:** Interface segregation per entity vs one generic repository; query objects vs many methods
- **Soft Deletes & Timestamps:** Why `deletedAt` matters for future sync; UTC storage vs local-date fields
- **Local Dates:** Storing calendar dates (`YYYY-MM-DD`) separately from instants; timezone pitfalls
- **Vitest:** Workspace config, coverage thresholds

### Setup Tasks:

1. **Workspace Structure** — `pnpm-workspace.yaml`, root `tsconfig.base.json`, path aliases `@orbit/core`, `@orbit/storage`
2. **Entity Schemas** — Zod schemas + inferred types for Area, Goal, Project, Milestone, Task, Event, Routine, RoutineInstance, Note, Person, Commitment, Bill, Block, DayCommitment, Session, Rule, Link, InsightState, OpLog
3. **ID & Clock Utilities** — `newId()` (uuid v7), `Clock` interface (injectable for tests), `LocalDate` helpers
4. **Repository Interface** — `Repository` with per-entity `get/list/query/upsert/softDelete`, `links`, `opLog.append/since`, `transaction`
5. **InMemoryRepository** — Full implementation, used by all engine tests
6. **Repository Contract Suite** — Shared test suite every adapter must pass (memory now; IndexedDB week 2; SQLite week 7)
7. **Vitest Setup** — Workspace runner, coverage thresholds (core ≥ 90%)

### Unit Tests Required:

- **Schema Tests:**
  - Every schema rejects missing required fields
  - Rule discriminated union parses all four types
  - Task `dependsOn` cannot include itself
- **Repository Contract Tests:**
  - Upsert then get returns the record
  - Soft delete hides from list but keeps the row
  - OpLog receives one entry per mutation
  - Transaction rolls back on throw

**What was done:**

- pnpm workspace (`apps/*`, `packages/*`), shared `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), packages consumed from source via `exports` → `src/index.ts`
- Zod 3 schemas for all 19 entity types in `schema/entities.ts` with defaults, plus shared primitives in `schema/common.ts` (`IdSchema` UUID v1–8, `InstantSchema`, `LocalDateSchema` with real-calendar check, `MinuteOfDaySchema`, `EnergySchema`, `EntityTypeSchema`, `BaseRecordSchema`)
- Cross-field rules: task cannot depend on itself; events/blocks/sessions must end after start; a block references at most one of task / routine instance / event
- `RuleSchema` as a discriminated union over the four families (constraint, recurring, rollover, reminder) with typed configs
- `newId()` (UUID v7), injectable `Clock` with `fixedClock` for tests, local-date helpers (`toLocalDate`, `addDays`, `minuteOfDay`, `formatMinute`, `parseMinute`, `toInstant`)
- `createRecord(schema, clock, fields)` stamps id/timestamps and applies defaults; `shallowPatch` for op-log diffs
- `Repository` interface: one `EntityStore` per entity (`get/getMany/list/query/count/upsert/softDelete`), `LinkStore.forEntity`, `OpLogReader.since/latestSeq`, `transaction` with nested-join semantics, `close`
- `InMemoryRepository`: validates every upsert, stamps `updatedAt` from the clock, writes one op-log entry per mutation (create/update/delete with patch), snapshot-and-restore transactions
- Repository contract suite (`test/contract.ts`) with 12 behaviours; memory adapter passes; IndexedDB (week 2) and SQLite (week 7) will run the same suite
- Vitest workspace at the root with `projects` for core, storage, and the app; 88 core+storage tests

**Files created:**

- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts` ✅
- `packages/core/{package.json,tsconfig.json,vitest.config.ts}` ✅
- `packages/core/src/schema/{common.ts,entities.ts,index.ts}` ✅
- `packages/core/src/{ids.ts,clock.ts,dates.ts,records.ts,index.ts}` ✅
- `packages/core/test/{schema.test.ts,dates.test.ts}` ✅
- `packages/storage/{package.json,tsconfig.json,vitest.config.ts}` ✅
- `packages/storage/src/{repository.ts,index.ts}`, `packages/storage/src/memory/index.ts` ✅
- `packages/storage/test/{contract.ts,memory.test.ts}` ✅

**Deliverables:**

- [x] `packages/core/src/schema/*.ts` — all entities
- [x] `packages/core/src/ids.ts`, `clock.ts`, `dates.ts`
- [x] `packages/storage/src/repository.ts` (interface)
- [x] `packages/storage/src/memory/index.ts`
- [x] `packages/storage/test/contract.ts`
- [x] Unit tests written and passing

**Verification:**

```bash
pnpm install
pnpm run type-check
pnpm vitest run --project core --project storage
```

---

## Week 2: IndexedDB Adapter, Op Log, Persistence & Export/Import ✅ COMPLETE

**Description:** This week you will make the data real in the browser. You will implement `IndexedDbRepository` on Dexie, persist the append-only operation log, request persistent storage so the browser does not evict Orbit's data, and build JSON and Markdown export plus JSON import with a dry-run report. This adapter is the web runtime's permanent store and the development store until the desktop shell arrives in week 7.

### Research Required:

- **Dexie:** Schema versioning, compound indexes, transactions across tables, `liveQuery`
- **IndexedDB Limits:** Storage quotas, eviction policies per browser, `navigator.storage.persist()` and `estimate()`
- **Export Formats:** Stable JSON envelope with schema version; Markdown per project/note for human readability
- **Browser File APIs:** Blob download for export; `<input type=file>` for import; File System Access API where available (Chromium)
- **Streaming Large Exports:** Chunked serialization to avoid memory spikes at 50k records

### Storage Tasks:

1. **Dexie Schema** — Tables + indexes per entity, `op_log` table, version 1
2. **IndexedDbRepository** — Implements `Repository`; passes the Week 1 contract suite (via `fake-indexeddb` in Node)
3. **Operation Log** — Written inside every transaction; `since(seq)` reader
4. **Persistent Storage** — Request on first run; expose `storageStatus` (persisted / quota / usage) for the settings UI
5. **Export / Import** — `exportJson()`, `exportMarkdown()`, `importJson()` with schema-version guard, dry-run report, merge vs replace modes
6. **Storage Factory** — `createRepository(platform)` returning the right adapter; the app never chooses directly

### Unit Tests Required:

- **Contract Tests:** Full Week 1 suite passes against IndexedDB
- **Persistence Tests:** Records survive a simulated page reload (new Dexie instance, same DB)
- **Export/Import Tests:** Round-trip preserves every record and link; import rejects newer schema version; dry-run reports counts without writing
- **Quota Tests:** `storageStatus` reports denied persistence correctly

**Deliverables:**

- [x] `packages/storage/src/indexeddb/*` — schema, adapter
- [x] `packages/storage/src/export/*` — JSON + Markdown
- [x] `packages/storage/src/factory.ts`
- [x] Unit tests written and passing

**What was done:**

- `IndexedDbRepository` on Dexie 4: one table per store with indexes on the fields the planner and lists will query (`projectId`, `status`, `dueAt`, `date`, compound `[fromType+fromId]` / `[toType+toId]` for links), plus an auto-increment `opLog`
- Every mutation validates first, then runs in a Dexie transaction over the table and the op log; repository `transaction()` wraps Dexie's, so a throw rolls everything back and nested calls become sub-transactions
- The Week 1 contract suite runs unchanged against IndexedDB via `fake-indexeddb` with a fresh `IDBFactory` per test; persistence test proves rows and op-log sequence survive close-and-reopen
- `UpsertOptions.preserveUpdatedAt` added to the interface (and memory adapter) so imports are lossless; contract test added
- JSON export: versioned envelope (`orbit-export`, schema 1), every store including soft-deleted rows, sorted by id, with the latest op-log seq; `parseExport` returns typed `ExportError` codes (`invalid-json`, `invalid-format`, `newer-schema`)
- JSON import: `merge` keeps the newer copy by `updatedAt`, `replace` makes the file authoritative and soft-deletes local rows absent from it; dry-run report per store; all writes in one transaction (atomicity tested)
- Markdown export: index by area → goal → project, one file per project (outcome, milestone checklist with progress, tasks with next-action marker) and per note, plus routines, people with commitments, and a bills table; unique slugs
- `openRepository({ kind })` factory; SQLite joins it in week 7
- Persistent storage request lives in the app's web platform (`navigator.storage.persist()`), surfaced by the frontend banner

**Files created:**

- `packages/storage/src/indexeddb/index.ts` ✅
- `packages/storage/src/export/{json.ts,markdown.ts,index.ts}` ✅
- `packages/storage/src/factory.ts` ✅
- `packages/storage/test/{indexeddb.test.ts,export.test.ts}` ✅
- `packages/storage/src/repository.ts` (UpsertOptions), `packages/storage/test/contract.ts` (+1 behaviour) ✅

**Verification:**

```bash
pnpm vitest run --project storage
pnpm run dev
# DevTools → Application → IndexedDB → orbit; reload; data persists
```

---

## Week 3: Capture Parser & Classifier ✅ COMPLETE

**Description:** This week you will build the deterministic natural-language parser behind the Universal Inbox. Given free text, it returns a classification (task, event, note, goal, routine, bill, relationship reminder) with extracted fields, a confidence, and ranked alternatives so the UI can offer one-keystroke correction. The parser is a pure function and must be exhaustively tested. A `Classifier` interface wraps it so a local model can be swapped in later.

### Research Required:

- **Date/Time Grammars:** `chrono-node` vs a custom grammar; relative dates ("next Friday", "in 3 days"), times, ranges
- **Recurrence Phrases:** "every month", "weekly", "mon/wed/fri", "every 2 weeks" → RRULE-like structure
- **Money Extraction:** Currency symbols, amounts, "bill", "pay" cues
- **Intent Cues:** "remind me", "ask X about", "idea", "note", "goal:"; explicit prefixes (`t:` `n:` `e:` `g:` `r:` `$` `@person` `#project`)
- **Confidence Scoring:** Simple additive rule weights; when to return `unclassified`

### Parser Tasks:

1. **Tokenizer & Prefix Grammar** — Explicit prefixes always win
2. **Date/Time Extraction** — Relative and absolute; produces `dueAt` or `startAt/endAt`
3. **Recurrence Extraction** — Produces `Recurrence` object (freq, interval, byDay, byMonthDay)
4. **Entity Mentions** — `@person`, `#project`, fuzzy match against existing names via injected lookup
5. **Classifier** — Combines cues into `{ type, fields, confidence, alternatives[] }`
6. **`Classifier` Interface** — `classify(text, ctx)`; rule-based implementation registered by default

### Unit Tests Required:

- **Golden Corpus:** ≥ 120 phrases with expected type + fields (the four spec examples included)
- **Date Tests:** "next Friday" relative to injected clock; month boundaries; year rollover
- **Recurrence Tests:** Every phrase form maps to the correct structure
- **Ambiguity Tests:** "Pay Omar 50 on Friday" → bill with person link, alternatives include task
- **Prefix Tests:** Prefix overrides all cues

**What was done:**

- Span-based extractors in `capture/extract.ts`: explicit prefixes (`t: n: e: g: r: b: c:`, `$`), `@person` / `#project` mentions, time ranges, recurrence (every/each + interval, weekday lists, weekdays, monthly on the Nth, yearly, N times a week), money (symbols, ISO codes, words, thousands, "pay Omar 50"), relative durations, absolute and relative dates (ISO, D Mon, Mon D, D/M, today/tomorrow/tonight, weekdays with next/this, next/this week/month/year/weekend, end of X, on the Nth, month-only "by June"), single times (at 5, 9:30, 6pm, noon, morning/evening), estimates (2h, 45m, 1h30), priority (urgent, p1–p3, !!), directed people ("ask Omar", "I owe Layla", "Omar owes me")
- Earlier extractors claim spans so later ones cannot overlap: recurrence before dates makes "every friday" a routine, not a deadline; "in 30 min" is a time, not an estimate
- All dates are local calendar dates and minutes-of-day, so results are timezone independent; the app combines them with `toInstant`
- Additive scoring in `classify.ts` over cue regexes and extracted facts; an explicit prefix scores 1.0; `alternatives` ranks all seven types for Tab-cycling; `reclassify()` re-derives fields for a chosen type
- Title tidying strips claimed spans, dangling connectors, and "remind me to"; keeps a leading "Weekly" in routine names
- `Classifier` interface with `ruleClassifier` as the default implementation
- `materializeCapture()` turns a type + fields into concrete records with sensible defaults (task due end of day, event 09:00 for an hour, bill due in a week, routine window from start + duration, commitment links or creates the person); typed `MaterializeError` for `needs-area` / `needs-person`
- New `Capture` entity (inbox item holding the guess, confidence, status, and what it became), `captures` store in both adapters (Dexie schema v2), export schema bumped to 2
- Golden corpus of 122 phrases across all seven types with field expectations, 100 % exact, plus a regression guard; date, recurrence, ambiguity, prefix, reclassify, and token tests

**Files created:**

- `packages/core/src/capture/{types.ts,extract.ts,classify.ts,materialize.ts,index.ts}` ✅
- `packages/core/src/schema/entities.ts` (CaptureSchema), `schema/common.ts` (entity type `capture`) ✅
- `packages/core/test/capture/{corpus.json,capture.test.ts,materialize.test.ts}` ✅
- `packages/storage/src/{repository.ts,memory/index.ts,indexeddb/index.ts,export/json.ts}` (captures store, Dexie v2, export v2) ✅

**Deliverables:**

- [x] `packages/core/src/capture/*` — tokenizer, dates, recurrence, money, mentions, classifier
- [x] `packages/core/test/capture/corpus.json`
- [x] Unit tests written and passing (corpus ≥ 95% exact match)

**Verification:**

```bash
pnpm run test --filter @orbit/core -- capture
```

---

## Week 4: Structure Services — Hierarchy, Links & Project Health ✅ COMPLETE

**Description:** This week you will implement the domain services that make Orbit "one connected system". Tasks belong to projects, projects advance goals, goals live in areas. Soft links connect notes, people, events, and bills to any of them. You will compute project progress from milestones, detect projects without a next action, measure goal attention, and identify blocked work through task dependencies.

### Research Required:

- **Tree Queries:** Materialized ancestor lookups vs on-demand traversal; keeping it simple for local data
- **Dependency Graphs:** Cycle detection, topological readiness, "blocked by" resolution
- **Attention Metrics:** Defining "attention" as sessions + completions per goal per rolling 14 days
- **Cascading Rules:** What happens on project archive (tasks archived), area delete (blocked if non-empty)

### Service Tasks:

1. **Hierarchy Service** — Reparent, ancestors, descendants, validation (task under project under goal under area)
2. **Link Service** — Create/remove typed soft links; list links for any entity; uniqueness
3. **Project Health** — Progress % from milestones, `noNextAction`, `staleDays` (from last op on project or its tasks), `blocked` (all open tasks blocked)
4. **Goal Attention** — Hours in last 14 days per goal; `neglected` flag vs area target
5. **Dependency Service** — Cycle prevention on `dependsOn`, readiness check used by the planner
6. **Archive/Delete Cascades** — Well-defined behaviour with op-log entries

### Unit Tests Required:

- Reparent updates ancestors; invalid parent types rejected
- Progress = done milestones / total; 0 milestones → uses task completion ratio
- Project with open tasks but no `nextActionTaskId` flagged
- Cycle in `dependsOn` rejected
- Goal with zero sessions in 14 days flagged neglected

**What was done:**

- Pure services in `packages/core/src/services` over an array snapshot, so the app loads once and persists what comes back
- `hierarchy.ts`: `validateGoalParent`, `validateProjectParent` (goal must share the project's area), `resolveTaskParent` (task area derived from its project; archived projects refused), `ancestorsOfTask`, `descendantsOfArea`, `archiveProjectCascade` (open/inbox tasks archived, done left alone, next action cleared), `assertAreaDeletable`; typed `HierarchyError`
- `dependencies.ts`: `wouldCreateCycle` (graph walk), `validateDependencies` (self / missing / cycle with a human message), `blockers`, `isReady`, `dependents`
- `projectHealth.ts`: progress from milestones, else task completion, else none; `noNextAction` (active project without a valid open next action), `blocked` (every open task waits), `staleDays` from the latest change to the project, its tasks, milestones, or sessions; `overdue` and `daysToDeadline`
- `goalAttention.ts`: session minutes in a rolling 14-day window per goal and per area; expectation from the area's weekly target split across its active goals; `neglected` when an active goal got zero time
- `links.ts`: `makeLink` returns the existing link for a pair in either direction, refuses self-links; `linkedRefs` / `groupLinked` for the linked panel
- `durations.ts`: `parseDuration` ("45", "1h30", "1:30", "2.5h", "90 min") and `formatDuration`
- Fixture builders in `test/builders.ts` (one per entity, seeded PRNG, and `aWorld()`: 2 areas, 3 goals, 4 projects, milestones, a dependency chain); 15 new tests

**Files created:**

- `packages/core/src/services/{hierarchy,dependencies,projectHealth,goalAttention,links,index}.ts`, `packages/core/src/durations.ts` ✅
- `packages/core/test/builders.ts`, `packages/core/test/services/structure.test.ts` ✅

**Deliverables:**

- [x] `packages/core/src/services/{hierarchy,links,projectHealth,goalAttention,dependencies}.ts`
- [x] Unit tests written and passing

**Verification:**

```bash
pnpm run test --filter @orbit/core -- services
```

---

## Week 5: Planning Engine v1

**Description:** This week you will build the heart of Orbit: `planDay`. It is a pure function from a state snapshot, a date, and settings to a proposal containing time blocks, a proposed commitment, an explanation per task, and an explicit "left out" list with reasons. Constraints are applied first, then a transparent score, then greedy fill. Acceptance turns the proposal into a `DayCommitment`.

### Research Required:

- **Scheduling Heuristics:** Greedy interval fill, earliest-deadline-first, why not full constraint solvers for v1
- **Score Design:** Deadline pressure curve, importance weighting, staleness bonus, energy matching penalty
- **Capacity Modelling:** Working window minus events, rest boundaries, buffer between blocks
- **Explainability:** Storing score components alongside the decision so the UI can render "why"
- **Determinism:** Same input → same plan (stable sort keys), essential for tests and trust

### Engine Tasks:

1. **Capacity Builder** — Free intervals for a date from working window, events, locked blocks, rest boundaries
2. **Candidate Selection** — Open tasks, ready (dependencies done), not deferred, plus due routine instances
3. **Scoring** — `score = pressure(due) × importance(goal) × (1 + staleness) × energyFit × overdueBoost`; components retained
4. **Greedy Fill** — Place candidates into free intervals by score; respect estimate; split allowed only above a threshold
5. **Explanations & Left-Out** — Every placed task has a `Why`; every skipped candidate has a reason (no capacity, blocked, low score, energy mismatch)
6. **Accept / Commitment** — `acceptPlan(proposal)` writes `DayCommitment` + `Block`s in one transaction

### Unit Tests Required:

- Empty day → empty plan, no throw
- Locked block never moved or overlapped
- Overdue task outranks same-importance future task
- Task with unmet dependency lands in left-out with reason `blocked`
- Low-energy day excludes high-energy tasks with reason `energy`
- Same snapshot planned twice yields identical output

**Deliverables:**

- [ ] `packages/core/src/planner/{capacity,candidates,score,fill,explain,index}.ts`
- [ ] Fixture snapshots in `packages/core/test/planner/fixtures/`
- [ ] Unit tests written and passing

**Verification:**

```bash
pnpm run test --filter @orbit/core -- planner
pnpm run bench:planner   # < 50 ms for 2,000 open tasks
```

---

## Week 6: Recurrence, Blocks & Recalculation

**Description:** This week you will implement routine recurrence, routine instances with exceptions, calendar events, and the block model used by the timeline. You will also implement `recalculateDay`, which re-plans the remainder of a day after the user moves, resizes, locks, or completes something, without touching locked blocks or elapsed time.

### Research Required:

- **RRULE Semantics:** Subset to support (DAILY/WEEKLY/MONTHLY, INTERVAL, BYDAY, BYMONTHDAY, COUNT/UNTIL); `rrule` library vs custom
- **Instance Exceptions:** Skipped / rescheduled instances stored as overrides
- **Block Arithmetic:** Minute-of-day representation, overlap detection, snapping to 15-minute grid
- **Partial-Day Replanning:** Freezing the past, keeping locked, refilling the future

### Engine Tasks:

1. **Recurrence Expansion** — `expandRecurrence(routine, range)` with exceptions
2. **Routine Instance Store** — Materialize instances for a rolling 4-week window; mark done/skipped
3. **Event Model** — Manual events; import hook reserved for later calendar integrations
4. **Block Operations** — Move, resize, lock, unlock, split; validation against overlaps
5. **`recalculateDay`** — Re-run fill for remaining free intervals after `now`; locked and completed blocks fixed
6. **Rule: "Schedule exercise three times per week"** — Recurring-scheduling rule feeds candidates (first typed rule)

### Unit Tests Required:

- Monthly on the 31st handles short months
- Skipped instance not regenerated
- Move that would overlap a locked block is rejected with a reason
- Recalculation after 14:00 never changes blocks before 14:00
- Weekly rule produces exactly N instances across a week when capacity exists

**Deliverables:**

- [ ] `packages/core/src/recurrence/*`, `packages/core/src/blocks/*`
- [ ] `packages/core/src/planner/recalculate.ts`
- [ ] Unit tests written and passing

**Verification:**

```bash
pnpm run test --filter @orbit/core -- recurrence blocks recalculate
```

---

## Week 7: Desktop Shell — Tauri, SQLite Adapter & Data File

**Description:** This week the desktop runtime arrives. You will add the Tauri 2 shell to `apps/orbit`, implement `SqliteRepository` on the Tauri SQL plugin with a versioned migration runner, store the data file in a user-chosen folder, run an integrity check on startup, and import the web build's JSON export so a user can move from browser to desktop without losing anything. The storage factory now returns SQLite on desktop and IndexedDB on web.

### Research Required:

- **Tauri 2 Basics:** Commands, capabilities, `tauri.conf.json`, dev server wiring with Vite
- **Tauri SQL Plugin:** `tauri-plugin-sql` with SQLite, connection lifetime, transactions, parameter binding
- **FTS5 Availability:** Whether the bundled SQLite has FTS5; detect at runtime via `pragma compile_options`
- **Migrations:** `user_version` pragma, forward-only migrations, migration tests against fixture DBs
- **SQLite Performance:** WAL mode, `synchronous=NORMAL`, indexes on `(deletedAt, dueAt)`, `(projectId)`, `(date)`
- **Integrity:** `PRAGMA integrity_check`, handling a corrupt file (rename + restore from backup)

### Storage Tasks:

1. **Tauri Shell** — `src-tauri` scaffold, window config, SQL/dialog/fs/notification plugins registered
2. **Schema Migrations** — `migrations/0001_init.sql` with all tables, indexes, `user_version`
3. **SqliteRepository** — Implements `Repository`; passes the Week 1 contract suite (via `better-sqlite3` in Node tests)
4. **Data File Location** — Rust command to read/set data folder; open/create DB on startup; WAL mode
5. **Integrity Check** — On startup; surface result to UI; auto-restore path from latest backup (backup rotation in week 13)
6. **Web → Desktop Import** — First-run import of a JSON export; `Platform.desktop` wired into the storage factory
7. **Global Quick-Capture Command** — Rust registers the global shortcut and opens the capture window

### Unit Tests Required:

- **Contract Tests:** Full Week 1 suite passes against SQLite
- **Migration Tests:** Fresh DB reaches latest version; fixture v1 DB migrates forward without data loss
- **Import Tests:** A week-2 JSON export imports into SQLite with zero diff
- **Integrity Tests:** Corrupt file detected; restore path chosen

**Deliverables:**

- [ ] `apps/orbit/src-tauri/*` — shell, plugins, `commands/data_dir.rs`, `commands/capture.rs`
- [ ] `packages/storage/src/sqlite/*` — adapter, migrations, runner
- [ ] Storage factory returns SQLite on desktop
- [ ] Unit tests written and passing

**Verification:**

```bash
pnpm run test --filter @orbit/storage
pnpm run tauri dev
# Settings → Data folder → change; confirm orbit.db created, WAL files present; import web export
```

---

## Week 8: Actuals, Sessions & Review Data Services

**Description:** This week you will add the primitive the insights depend on: what actually happened. Sessions record start/stop per task. Completing a task without a session prompts for actual minutes. You will build the data services behind the morning briefing (energy, proposal, at-risk items) and the evening shutdown (compare commitment vs actuals, roll over unfinished work).

### Research Required:

- **Timers Across Restarts:** Persisting an active session; monotonic vs wall clock
- **Rollover Policies:** Move to tomorrow vs back to inbox vs next week by priority
- **At-Risk Definition:** Overdue, due within 48h with no block, project deadline within 7 days with < 50% progress
- **Estimate Accuracy:** Ratio of actual to estimate per task type / area, rolling window

### Service Tasks:

1. **Session Service** — Start, stop, active session persistence, manual entry
2. **Completion Flow** — `completeTask(id, actualMin?)`; updates `actualMin`; op-log entry
3. **Morning Service** — `buildMorning(date)` → energy prompt, plan proposal, at-risk list, bills due ≤ 3 days
4. **Evening Service** — `buildEvening(date)` → committed vs done, time by area, unfinished list with rollover suggestions
5. **Rollover** — `applyRollover(choices)`; rule type "rollover" honoured (e.g. low-priority → next week)
6. **Time-by-Area Aggregation** — Used by "where is my time going"

### Unit Tests Required:

- Active session survives simulated restart
- Completing with actual updates ratio store
- Evening lists exactly the unfinished committed tasks
- Rollover rule moves P3 tasks to next Monday, P1 to tomorrow
- Time-by-area sums sessions correctly across midnight

**Deliverables:**

- [ ] `packages/core/src/services/{sessions,completion,morning,evening,rollover}.ts`
- [ ] Unit tests written and passing

**Verification:**

```bash
pnpm run test --filter @orbit/core -- sessions morning evening rollover
```

---

## Week 9: Rules Engine & Reminder Scheduler

**Description:** This week you will implement the four typed rule families and their evaluation inside the planner and reminder scheduler: time constraints ("never schedule demanding work after 7 PM", "reserve Friday evening for family"), recurring scheduling ("exercise three times per week"), rollover policies, and reminders/follow-ups ("bill due within three days", "no reply after seven days"). Rules are structured objects, never parsed sentences. On desktop a Rust scheduler fires OS notifications; on web, reminders surface only while the app is open.

### Research Required:

- **Rule Representation:** Discriminated union with per-type config; versioning rule configs
- **Constraint Application:** Translating a constraint rule into blocked intervals or candidate filters
- **Reminder Scheduling Offline:** Computing next-fire times; a resident scheduler in the Tauri shell; in-app scheduler for web
- **Conflict Resolution:** Two rules that contradict; priority order and surfacing conflicts to the user

### Rule Tasks:

1. **Constraint Rules** — `noHighEnergyAfter(time)`, `reserve(dayOfWeek, window, areaId)` → capacity builder
2. **Recurring Scheduling Rules** — `timesPerWeek(routineId, n)` → candidate generator (completes Week 6 item)
3. **Rollover Rules** — `rolloverPolicy(priority → target)` → evening service
4. **Reminder Rules** — `billDueWithin(days)`, `followUpAfter(days)` → reminder queue
5. **Reminder Queue** — Table of pending reminders with `fireAt`; Rust scheduler polls and raises OS notifications; web scheduler uses in-app toasts
6. **Rule Conflict Report** — Detect overlapping constraints; returned to settings UI

### Unit Tests Required:

- No high-energy task placed after 19:00 when rule enabled
- Friday 18:00–22:00 reserved → zero non-family blocks
- Bill due in 2 days produces one reminder, not one per run
- Commitment to a person with no reply for 8 days → follow-up reminder
- Conflicting reservations reported

**Deliverables:**

- [ ] `packages/core/src/rules/*`
- [ ] `apps/orbit/src-tauri/src/scheduler.rs` — reminder polling + notifications
- [ ] Unit tests written and passing

**Verification:**

```bash
pnpm run test --filter @orbit/core -- rules
pnpm run tauri dev   # create a bill due tomorrow, observe OS notification
```

---

## Week 10: Search Index & Command Registry

**Description:** This week you will build global search and the command registry behind the palette. Search uses a MiniSearch in-process index on both runtimes, rebuilt from the op log and updated incrementally, with SQLite FTS5 as the desktop backend when available. The command registry exposes typed commands ("Add task", "Plan my day", "Show neglected goals", "Reschedule unfinished work") with argument schemas so the UI can render them uniformly.

### Research Required:

- **MiniSearch:** Fuzzy + prefix, field boosting, incremental updates, index serialization for fast startup
- **FTS5:** External-content tables, triggers to keep index in sync, `bm25` ranking, prefix queries
- **Command Pattern:** Command id, title, keywords, arg schema (Zod), `run(ctx, args)`; undo support
- **Query Language:** Minimal filters (`type:note area:university`)

### Search Tasks:

1. **SearchService Interface** — `search(query, filters, limit)` returning typed hits with snippets
2. **MiniSearch Backend** — Rebuild on startup, incremental on op log, serialized cache
3. **FTS5 Backend (desktop)** — Runtime detection; FTS tables + sync triggers for tasks, notes, projects, people
4. **Command Registry** — Core commands: add task/note/event, open project, plan my day, regenerate, show neglected goals, review this week, reschedule unfinished work
5. **Undo Stack** — Op-log-backed undo for the last N mutations

### Unit Tests Required:

- Both search backends pass the same contract tests
- Prefix query "univ" finds "university" note
- Filter `type:note` excludes tasks
- Command arg validation rejects bad input with a message
- Undo reverses the last mutation and appends a compensating op

**Deliverables:**

- [ ] `packages/storage/src/search/{minisearch,fts5,index}.ts`
- [ ] `packages/core/src/commands/*`
- [ ] Unit tests written and passing

**Verification:**

```bash
pnpm run test --filter @orbit/storage -- search
pnpm run bench:search   # < 30 ms for 50k notes
```

---

## Week 11: Insights Engine

**Description:** This week you will implement `computeInsights`, producing explainable observations from real data. Each insight carries evidence records, the threshold that triggered it, and a snooze/dismiss state. First four: estimate bias by task type, stale projects, overloaded days, and goals requiring more weekly hours than available.

### Research Required:

- **Thresholds:** Choosing defaults (stale ≥ 10 days, overload > 110% capacity, bias > 1.3×) and making them settings
- **Evidence Design:** Referencing entity ids + numbers so the UI can drill down
- **Noise Control:** Snooze durations, dismissal, max insights per surface
- **Statistical Care:** Minimum sample sizes before claiming a bias

### Insight Tasks:

1. **Insight Framework** — `Insight { key, severity, title, detail, evidence[], threshold, computedAt }`; state store
2. **Estimate Bias** — Actual/estimate ratio per area or tag with ≥ 5 samples
3. **Stale Project** — No op on project or its tasks for ≥ N days
4. **Overloaded Day** — Committed minutes > capacity × 1.1 for any day in the next 7
5. **Goal Time Deficit** — Sum of area weekly targets vs available weekly hours
6. **Person Commitments** — Count of open commitments per person ≥ 3 (light, feeds people view)

### Unit Tests Required:

- Bias not reported with 4 samples; reported with 5
- Snoozed insight omitted until `snoozedUntil`
- Overload evidence lists the exact blocks
- Deficit uses working window from settings
- Each insight has non-empty evidence

**Deliverables:**

- [ ] `packages/core/src/insights/*`
- [ ] Unit tests written and passing

**Verification:**

```bash
pnpm run test --filter @orbit/core -- insights
```

---

## Week 12: Weekly Review, People, Bills & Tray

**Description:** This week you will build the data services behind the weekly review and complete the people/commitments and bills flows. The weekly review processes the inbox, cleans overdue tasks, inspects every active project, updates goals, reviews bills, and prepares next week's capacity check. The Rust shell gains tray presence and autostart so reminders work while the window is closed.

### Research Required:

- **Guided Flow State:** Step machine with resumability (a review can be paused)
- **Tauri Tray & Autostart:** `tauri-plugin-autostart`, tray menu, hide-to-tray behaviour
- **Notification Plugin:** Permissions on Windows, click-to-open deep links
- **Follow-Up Semantics:** "Waiting for" vs "owed"; marking replied

### Service Tasks:

1. **Weekly Review Service** — Steps: inbox zero → overdue → projects (health per project, set next action) → goals (attention) → bills → next-week capacity vs commitments
2. **Review Persistence** — Resume a partially completed review
3. **People & Commitments** — CRUD, mark replied, follow-up rule integration, "made 3 commitments" insight hookup
4. **Bills** — CRUD, recurrence via Week 6 engine, paid marking, due-soon query
5. **Tray + Autostart** — Rust: tray icon, menu (Open, Plan my day, Quit), autostart toggle
6. **Notification Deep Links** — Clicking a reminder opens the relevant entity

### Unit Tests Required:

- Review step machine resumes at the correct step
- Overdue cleanup offers reschedule/drop and records the choice
- Capacity check flags next week when commitments exceed capacity
- Recurring bill generates the next due after paid
- Follow-up cleared when reply marked

**Deliverables:**

- [ ] `packages/core/src/services/{weeklyReview,people,bills}.ts`
- [ ] `apps/orbit/src-tauri/src/{tray,autostart}.rs`
- [ ] Unit tests written and passing

**Verification:**

```bash
pnpm run test --filter @orbit/core -- weeklyReview people bills
pnpm run tauri dev   # close window, confirm tray icon, reminder still fires
```

---

## Week 13: Hardening, Performance & Data Safety

**Description:** This week you will make the data layer trustworthy for daily use over years. You will benchmark with 50k records on both runtimes, add rotating backups with restore on desktop, decide and implement the encryption option, run migration tests from every prior schema version, and add a diagnostics bundle (logs + schema version + integrity result, never content) that users can attach to bug reports.

### Research Required:

- **SQLite Backup API:** Online backup vs file copy with WAL checkpoint
- **Encryption Options:** SQLCipher availability in the Tauri plugin vs encrypting exports only (decide, document)
- **Log Rotation:** Local structured logs, size caps, no PII
- **Benchmark Harness:** Seed generator, timing planner/search/startup on both adapters

### Hardening Tasks:

1. **Backup Rotation (desktop)** — Daily backup on first launch of the day, keep 7 daily + 4 weekly; restore command
2. **Export Nag (web)** — Remind to export when last export > 7 days and > 100 ops since
3. **Seed & Benchmark Scripts** — `scripts/seed.ts` (50k tasks, 10k notes), `scripts/bench.ts` for both adapters
4. **Migration Matrix Tests** — Fixture DBs for every released schema version (SQLite and Dexie)
5. **Encryption Decision** — Implement chosen option; document limits
6. **Diagnostics Bundle** — Rust command zips logs + metadata to a user-chosen path; web downloads the equivalent JSON
7. **Startup Budget** — Cold start to interactive < 1.5 s with 50k records

### Unit Tests Required:

- Backup rotation keeps exactly the configured count
- Restore from backup passes integrity check
- All fixture versions migrate to latest on both adapters
- Seeded planner run < 50 ms; search < 30 ms
- Diagnostics bundle contains no note bodies or task titles

**Deliverables:**

- [ ] `packages/storage/src/backup/*`
- [ ] `scripts/seed.ts`, `scripts/bench.ts`
- [ ] `apps/orbit/src-tauri/src/commands/diagnostics.rs`
- [ ] Unit tests written and passing

**Verification:**

```bash
pnpm run seed -- --tasks 50000
pnpm run bench
pnpm run test
```

---

## Summary: Backend Implementation Status

| Week        | Feature Area                                           | Status      | Progress |
| ----------- | ------------------------------------------------------ | ----------- | -------- |
| **Week 1**  | Monorepo, Schemas & In-Memory Repository               | ✅ COMPLETE | 100%     |
| **Week 2**  | IndexedDB Adapter, Op Log, Persistence & Export/Import | ✅ COMPLETE | 100%     |
| **Week 3**  | Capture Parser & Classifier                            | ✅ COMPLETE | 100%     |
| **Week 4**  | Structure Services — Hierarchy, Links & Project Health | ✅ COMPLETE | 100%     |
| **Week 5**  | Planning Engine v1                                     | ⏳ PENDING  | 0%       |
| **Week 6**  | Recurrence, Blocks & Recalculation                     | ⏳ PENDING  | 0%       |
| **Week 7**  | Desktop Shell — Tauri, SQLite Adapter & Data File      | ⏳ PENDING  | 0%       |
| **Week 8**  | Actuals, Sessions & Review Data Services               | ⏳ PENDING  | 0%       |
| **Week 9**  | Rules Engine & Reminder Scheduler                      | ⏳ PENDING  | 0%       |
| **Week 10** | Search Index & Command Registry                        | ⏳ PENDING  | 0%       |
| **Week 11** | Insights Engine                                        | ⏳ PENDING  | 0%       |
| **Week 12** | Weekly Review, People, Bills & Tray                    | ⏳ PENDING  | 0%       |
| **Week 13** | Hardening, Performance & Data Safety                   | ⏳ PENDING  | 0%       |

**Total Progress:** 4/13 weeks complete (31%)
