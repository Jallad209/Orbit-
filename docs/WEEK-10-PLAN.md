# Orbit — Week 10 Implementation Plan

## Outcome

Ship a private, keyboard-first command center:

- `Ctrl+K` opens a command palette.
- Search covers tasks, notes, projects, and people on web and desktop.
- Search supports prefixes, typo tolerance, snippets, and small filters such as `type:note` and `area:university`.
- Commands validate arguments before they mutate data.
- The last 20 eligible mutations can be undone safely and atomically.
- Desktop diagnostics are local rolling logs; web diagnostics are a bounded JSON download.
- No title, note body, query text, SQL parameter, or automatic network upload appears in diagnostics.

Week 10 starts only after the completed Week 8–9 fixes are committed or otherwise recorded as a stable baseline. Do not mix a Week 10 feature commit with the transaction, restore, reminder, settings, rules, or Markdown fixes.

## Scope boundaries

In scope:

- Search index and shared search contract.
- MiniSearch backend for both runtimes.
- SQLite FTS5 backend with runtime fallback.
- Command registry and command palette.
- Search route and result quick actions.
- Bounded, op-log-backed undo.
- Local diagnostics and bug-report documentation.

Out of scope:

- The Week 11 insights engine.
- Full People, Bills, Notes, or Weekly Review screens; those remain Week 12.
- Sync, accounts, telemetry, cloud search, or remote error reporting.
- Tray/autostart packaging; that remains Week 11.

Because `/people`, `/bills`, and `/notes` are currently placeholders, Week 10 must provide a useful read-only preview route or drawer for search results without pretending those full screens are complete.

## Preconditions and baseline

1. Confirm the Week 8–9 gate is green:

   ```bash
   pnpm install --frozen-lockfile
   pnpm format:check
   pnpm lint
   pnpm type-check
   pnpm test:coverage
   pnpm --filter orbit run build
   pnpm check:bundle
   pnpm exec playwright test --workers=1
   pnpm run e2e:desktop
   cargo fmt --manifest-path apps/orbit/src-tauri/Cargo.toml --check
   cargo clippy --manifest-path apps/orbit/src-tauri/Cargo.toml -- -D warnings
   ```

2. Record the current benchmark and bundle results before adding the index.
3. Make sure the SQLite restore tests cover databases without Week 10 search tables. A valid Week 9 backup must still restore after the schema bump.
4. Keep all clocks fixed in new tests. Do not create tests that depend on the current wall-clock time.

## Architecture decisions

### Search contract

Add a runtime-neutral contract in `packages/storage/src/search/index.ts`:

```ts
type SearchFilters = {
  types?: EntityType[];
  areaId?: Id;
};

type SearchHit = {
  id: Id;
  type: 'task' | 'note' | 'project' | 'person';
  title: string;
  snippet: string;
  score: number;
  matchedFields: string[];
};

interface SearchService {
  ready(): Promise<void>;
  search(query: string, filters?: SearchFilters, limit?: number): Promise<SearchHit[]>;
  refresh(): Promise<void>;
  close?(): Promise<void>;
}
```

The contract must exclude soft-deleted records. Search results are ranked by title before body/name/contact, then by backend score and stable `updatedAt`/id tie-breakers. A blank query returns no hits, not every record.

### Query parsing

Implement a small parser, not a general query language:

- `type:task`, `type:note`, `type:project`, `type:person`.
- `area:<name-or-id>`.
- Remaining text is the free-text query.
- Unknown filters remain searchable text and produce no destructive behavior.
- Malformed filters return a user-visible validation message.

The parser must be shared by MiniSearch, FTS5, the palette, and `/search`.

### Index source of truth

The repository remains authoritative. The index is a rebuildable cache:

- Initial build reads live records from the four searchable stores.
- An op-log cursor is stored in memory and advances only after successful indexing.
- Create/update adds or replaces a document.
- Delete removes it.
- Import, restore, and data-folder relocation invalidate the cursor and rebuild.
- A failed incremental update leaves the old index usable and schedules a full rebuild.

Do not put user text in the op-log cursor or diagnostics.

### Desktop backend

Use FTS5 only when a capability probe succeeds. The native bundled SQLite already exposes an FTS5 capability result through `integrityCheck`; add a separate search probe that creates or queries the FTS5 structures without changing user data when probing.

FTS5 is an optimization, not a second behavior contract. MiniSearch remains the fallback for unsupported SQLite builds and the web runtime. FTS5 tables must be backfilled for existing rows and maintained for later writes; triggers alone are not enough for existing data.

### Undo model

The current op-log patch records changed values but not the previous values. Before implementing undo, extend mutation logging with an internal reversible envelope:

```ts
type UndoEntry = {
  id: string;
  at: string;
  entity: EntityType;
  entityId: Id;
  before: BaseRecord | null;
  after: BaseRecord | null;
  expectedUpdatedAt: string;
};
```

Only command-registry mutations create undo entries. Keep the last 20 per runtime session. Undo must:

- Run in one repository transaction.
- Verify the record still has `expectedUpdatedAt`.
- Refuse with a clear message if another window changed it.
- Restore the previous record or soft-delete a command-created record.
- Append a compensating op-log entry.
- Never undo an import, restore, or another user action outside the command registry.

If changing the public op-log schema is too disruptive, store the reversible envelope in a private in-memory stack and append the compensating operation with an explicit `undoOf` marker in the patch. Do not claim undo survives restart unless it actually does.

## Day-by-day execution

### Day 1 — Contract, parser, and fixtures

Backend first.

1. Add `SearchFilters`, `SearchHit`, `SearchService`, query parsing, entity-to-document mapping, and deterministic ranking rules.
2. Decide indexed text:
   - task: title plus project/area title;
   - note: title plus body;
   - project: title, outcome, area title;
   - person: name, contact.
3. Add builders for search records and a fixture containing:
   - `university` note;
   - a similarly titled task;
   - an area named University;
   - a person and project.
4. Add contract tests independent of backend implementation.
5. Add the dependency in the workspace lockfile only after choosing the pinned MiniSearch version.

Exit gate: parser and contract tests pass; no UI changes yet.

### Day 2 — MiniSearch index

1. Add `packages/storage/src/search/minisearch.ts`.
2. Configure title/name boost, prefix matching, bounded fuzzy matching, and stored fields only.
3. Implement initial rebuild, add/replace/remove, search, and serialization/deserialization.
4. Add `searchIndexState` in memory only; do not add a persisted entity unless startup measurements prove serialization is required.
5. Subscribe to repository write notifications through the existing app data-version mechanism, but debounce rebuilds and never run two rebuilds concurrently.
6. Test:
   - `univ` finds `university`;
   - `type:note` excludes tasks;
   - deleted rows disappear;
   - an update changes the hit without a full page reload;
   - malformed filters do not mutate data;
   - concurrent refresh calls coalesce.

Exit gate: MiniSearch contract suite passes on a 50,000-task fixture and a small mixed fixture.

### Day 3 — SQLite FTS5 and migration safety

1. Add `packages/storage/src/search/fts5.ts`.
2. Add an explicit FTS migration/version only if the tables are stored in the Orbit database. Prefer a rebuildable FTS cache with a clear schema marker.
3. Create FTS5 content for tasks, notes, projects, and people with stable entity type/id columns.
4. Backfill existing live rows in one bounded transaction.
5. Maintain inserts, updates, and deletes atomically with the source record. If triggers are used, test both backfill and subsequent changes.
6. Use `snippet()` for snippets and `rank`/`bm25` for ranking; sanitize query tokens before `MATCH`.
7. Update restore validation:
   - Week 9 backup lacking the FTS table is accepted and rebuilt;
   - current backup with FTS content is verified;
   - corrupt or partial FTS content causes rebuild, not data loss.
8. Add a runtime factory selecting FTS5 or MiniSearch.

Exit gate: both backends pass the same behavior contract; migrations, restore, and integrity tests pass.

### Day 4 — Core command registry

Create `packages/core/src/commands/` and export it from core.

1. Define `CommandContext` with repository, clock, navigation callback, notification callback, and capability flags.
2. Define command metadata: id, title, keywords, group, shortcut, argument schema, availability predicate, run, and optional undo description.
3. Implement commands in this order:
   - Add task (capture text through the existing capture/materialize path).
   - Add note.
   - Add event.
   - Open project.
   - Plan my day.
   - Regenerate today’s proposal.
   - Show neglected goals (navigate to the future insights route only if available; otherwise show a safe explanation).
   - Review this week (route to the existing weekly placeholder with an explicit “not available yet” state, or defer registration until Week 12).
   - Reschedule unfinished work (argument prompt and preview before mutation).
4. Validate arguments with Zod before `run`.
5. Connect eligible mutations to the undo stack.

Exit gate: command unit tests cover availability, valid/invalid args, successful mutation, and no mutation on validation failure.

### Day 5 — Undo and operation concurrency

1. Implement the session undo stack and `undoLast()`.
2. Add optimistic-concurrency checks using `updatedAt` and repository transactions.
3. Test command mutation → undo → exact previous record, including soft deletes.
4. Test the compensating op-log entry.
5. Test two repository/webview actors: a stale undo must fail and must not overwrite the newer record.
6. Add a visible “Undo” action to success toasts and a palette command for “Undo last action”.

Exit gate: undo is atomic, conflict-safe, and tested on memory, IndexedDB, and SQLite repositories.

### Day 6 — Command palette shell

Create `apps/orbit/src/features/palette/`.

1. Add `CommandPalette.tsx`, `useCommandPalette.ts`, `PaletteResults.tsx`, `ArgumentPrompt.tsx`, and tests.
2. Register `ctrl+k` through the existing hotkey registry with `allowInInput` only for the chord.
3. Use an accessible dialog/combobox pattern:
   - labelled input;
   - active descendant or roving focus;
   - visible result count/status;
   - Escape closes;
   - focus returns to the trigger.
4. Group commands and search results separately.
5. Fuzzy-filter command titles and keywords locally; debounce repository search and cancel stale requests.
6. Store only command ids in recent history, capped at 10.
7. Inline argument prompts must support keyboard-only submit/cancel and show validation errors without losing focus.

Exit gate: component tests cover open/close/focus, “plan” ranking, add-task prompt, validation error, and recent command behavior.

### Day 7 — Global search route and result actions

1. Replace the `/search` placeholder with `SearchPage.tsx` and `apps/orbit/src/features/search/`.
2. Support URL state: `/search?q=...`, parsed filters, and back/forward navigation.
3. Render mixed hits with:
   - type chip;
   - safe highlighted snippet (React text segments, never `dangerouslySetInnerHTML`);
   - stable empty/loading/error states;
   - keyboard selection and Enter.
4. Add quick actions only where behavior already exists:
   - open project;
   - complete task;
   - schedule task today;
   - link entity.
5. Add a read-only preview drawer for note/person results so placeholder routes do not dead-end.
6. Add a “Search all” path from the palette when results exceed the palette limit.

Exit gate: browser tests cover search from `Ctrl+K`, filters, opening a project, and a note/person preview.

### Day 8 — Diagnostics foundation

Desktop:

1. Add `apps/orbit/src-tauri/src/logging.rs`.
2. Use structured local logs with daily rotation, 10 MB maximum per file, and seven retained files. Keep levels quiet in release and verbose in development.
3. Register the logging plugin/setup in `lib.rs`.
4. Add a panic hook that writes a redacted crash record and a last-run marker. Avoid recursive logging from the panic hook.
5. Add safe fields only: timestamp, level, subsystem, operation name, duration, app version, schema version, platform, and integrity outcome.

Web:

6. Add a 500-entry ring buffer in `apps/orbit/src/lib/diagnostics.ts`.
7. Capture `console.error`, `window.onerror`, and unhandled rejection metadata without titles, bodies, URLs containing queries, or raw error objects that may contain data.
8. Keep diagnostics collection opt-in at export time and never send it over the network.

Exit gate: privacy tests prove sensitive fixture strings are absent from diagnostics.

### Day 9 — Diagnostics export, settings, and documentation

1. Add a desktop `diagnostics_export` Tauri command that creates a local zip containing:
   - redacted rolling logs;
   - app/build/schema versions;
   - runtime/capability summary;
   - integrity result;
   - last-run/crash marker;
   - benchmark version, if available.
2. Add the web equivalent JSON download through `platform.exportFile`.
3. Add “Save diagnostics bundle” to Data Settings with progress, cancellation/error state, and the saved path/name.
4. Add `docs/BUG-REPORTS.md` explaining:
   - what the bundle contains;
   - what it never contains;
   - how to inspect it before sharing;
   - how to report reproduction steps and app version;
   - that Orbit has no automatic telemetry.
5. Add desktop and web tests for export shape, redaction, failed export, and successful download.

Exit gate: a manually inspected bundle contains no personal record content.

### Day 10 — Performance, integration, and release gate

1. Replace the placeholder title scan in `scripts/bench.ts` with the real MiniSearch query benchmark over 50,000 tasks/notes.
2. Keep the query target under 30 ms and fail if the mean regresses more than 25% from baseline.
3. Measure startup with and without index deserialization; do not let the index delay the Today screen.
4. Run all tests and both repository adapters.
5. Run browser and desktop E2E, including two-window search/update behavior.
6. Review bundle growth from MiniSearch and palette code; lazy-load `/search` and the palette if needed.
7. Update backend/frontend/DevOps task docs to Week 10 complete only after every gate passes.
8. Create one Conventional Commit for Week 10 after the user explicitly asks to commit.

## Required file map

### Core

- `packages/core/src/commands/index.ts`
- `packages/core/src/commands/types.ts`
- `packages/core/src/commands/commands.ts`
- `packages/core/src/commands/undo.ts`
- `packages/core/test/commands/commands.test.ts`
- `packages/core/test/commands/undo.test.ts`

### Storage

- `packages/storage/src/search/index.ts`
- `packages/storage/src/search/query.ts`
- `packages/storage/src/search/documents.ts`
- `packages/storage/src/search/minisearch.ts`
- `packages/storage/src/search/fts5.ts`
- `packages/storage/src/search/factory.ts`
- `packages/storage/test/search/contract.ts`
- `packages/storage/test/search/minisearch.test.ts`
- `packages/storage/test/search/sqlite.test.ts`
- `packages/storage/test/search/concurrency.test.ts`

### App

- `apps/orbit/src/features/palette/CommandPalette.tsx`
- `apps/orbit/src/features/palette/useCommandPalette.ts`
- `apps/orbit/src/features/palette/PaletteResults.tsx`
- `apps/orbit/src/features/palette/ArgumentPrompt.tsx`
- `apps/orbit/src/features/palette/CommandPalette.test.tsx`
- `apps/orbit/src/features/search/SearchPage.tsx`
- `apps/orbit/src/features/search/SearchResults.tsx`
- `apps/orbit/src/features/search/SearchPreview.tsx`
- `apps/orbit/src/features/search/searchService.ts`
- `apps/orbit/src/features/search/SearchPage.test.tsx`
- `apps/orbit/src/lib/diagnostics.ts`
- `apps/orbit/src/features/settings/DiagnosticsSettings.tsx`
- `apps/orbit/src/platform/types.ts`
- `apps/orbit/src/platform/web.ts`
- `apps/orbit/src/platform/desktop.ts`
- `apps/orbit/src/routes.tsx`

### Desktop and docs

- `apps/orbit/src-tauri/src/logging.rs`
- `apps/orbit/src-tauri/src/commands/diagnostics.rs`
- `apps/orbit/src-tauri/src/lib.rs`
- `apps/orbit/src-tauri/Cargo.toml`
- `apps/orbit/src-tauri/capabilities/default.json`
- `docs/BUG-REPORTS.md`
- `.github/workflows/bench.yml`
- `.github/workflows/data-safety.yml`

## Test matrix

### Core and storage

- Search parser: free text, `type:`, `area:`, unknown/malformed filters.
- Contract parity: MiniSearch and FTS5 return the same entity set and required ordering properties.
- Prefix, fuzzy, title boost, snippets, limit, stable ties.
- Create/update/delete/import/restore index lifecycle.
- Rebuild after a stale/missing/corrupt cache.
- FTS5 unavailable fallback.
- 20-item undo cap, invalid argument rejection, compensating op-log entry.
- Stale undo conflict and transaction rollback.

### App

- `Ctrl+K` opens; Escape closes; trigger regains focus.
- “plan” ranks “Plan my day” first.
- Add task prompts, validates, writes once, and offers undo.
- Search results display type chips and safe highlights.
- `type:note` excludes tasks in both palette and full search.
- URL query/filter state survives navigation.
- Keyboard-only result/action flow.
- Diagnostics download works on web and desktop and redacts sensitive strings.

### Desktop

- FTS5 probe and fallback.
- Search across both main and capture webviews.
- Logging rotation and retention.
- Panic/last-run marker behavior.
- Diagnostics zip contents and redaction.
- Week 9 backup restore without Week 10 search tables.
- Current backup restore with search tables.

## Verification commands

Run in this order:

```bash
pnpm exec vitest run --project core commands
pnpm exec vitest run --project storage search
pnpm exec vitest run --project orbit palette search diagnostics settings
pnpm run bench -- --tolerance 25
pnpm format:check
pnpm lint
pnpm type-check
pnpm test:coverage
pnpm --filter orbit run build
pnpm check:bundle
pnpm exec playwright test --workers=1
pnpm run tauri:build:bin
pnpm run e2e:desktop
cargo fmt --manifest-path apps/orbit/src-tauri/Cargo.toml --check
cargo clippy --manifest-path apps/orbit/src-tauri/Cargo.toml -- -D warnings
pnpm run verify:backup
pnpm run test:roundtrip
```

Then run the parallel browser suite once as a final confidence check. Do not relax a performance budget to make a failing benchmark green; investigate the measurement and compare it with the baseline.

## Acceptance checklist

- [ ] Search service contract is shared by web and desktop.
- [ ] MiniSearch supports prefix/fuzzy search, title boosting, snippets, filters, and incremental updates.
- [ ] FTS5 is detected at runtime, backfilled, maintained, and has a MiniSearch fallback.
- [ ] Week 9 backups restore successfully without Week 10 cache tables.
- [ ] Commands are typed, validated, capability-aware, and do not mutate on invalid input.
- [ ] Undo is atomic, bounded, compensating, and protected against stale writes.
- [ ] Palette is accessible and keyboard-first.
- [ ] `/search` is real, URL-addressable, and has useful note/person previews.
- [ ] Diagnostics are local-only, bounded, redacted, and manually inspected.
- [ ] Search benchmark is real and under 30 ms on the baseline machine.
- [ ] Coverage, type-check, lint, build, bundle, browser, desktop, Rust, migration, backup, and roundtrip gates pass.
- [ ] Task docs and changelog notes accurately describe what shipped.

## Risk controls and stop conditions

- If FTS5 changes threaten data migration safety, ship MiniSearch first and keep FTS5 behind a feature-detected cache. Do not block search on the optimization.
- If undo cannot obtain previous values without changing the public data model safely, ship session-only command undo with explicit UI wording; do not provide misleading durable undo.
- If the palette causes a bundle regression, lazy-load its command UI while keeping the registry in core.
- If diagnostics cannot be proven redacted, do not expose the export button; fix the allowlist and tests first.
- If full People/Notes/Bills pages are needed for a result action, keep the action as a preview/open drawer and leave management to Week 12.
- No scope expansion into insights, tray, sync, accounts, telemetry, or updater work during Week 10.
