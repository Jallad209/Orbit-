# Orbit — Week 12 Detailed Implementation Plan

## 1. Outcome, baseline, and scope

Finish Orbit’s main daily-use workflows: a resumable weekly review, useful People/Bills/Notes screens, and notification clicks that open the right record.

This document is a plan, not an implementation or verification report. Unchecked gates remain future work.

- Prepared: 14 September 2026.
- Repository baseline: 7473aa2 — docs(insights): state that only the engine is benchmarked; Week 11 implementation is recorded through c1105b5.
- Week 11 insights and resident shell are implemented. Reuse them; do not rebuild the tray, autostart, or insights engine.
- Current data versions: SQLite 2, IndexedDB 3, JSON export 4.
- Current application version: 0.1.0-alpha.2.
- Inputs: docs/BACKEND-TASKS.md, docs/FRONTEND-TASKS.md, docs/DEVOPS-TASKS.md, docs/WEEK-11-PLAN.md, docs/INSIGHTS.md, docs/RESIDENT-BEHAVIOUR.md, and the current source.
- Preserve existing untracked Week 10 and Week 11 plans and any unrelated work.
- Recommended estimate for one developer: 15 focused working days for core Week 12, then 3–5 additional days for the optional updater if its external prerequisites are available. Allow 2 contingency days for Windows verification.
- “Week 12” is a milestone, not a promise to fit this scope into five calendar days.

### Finished experience

1. Start a six-step weekly review, make real changes, pause, close Orbit, and resume at the saved step with saved decisions.
2. Manage people and commitments without confusing what you owe with what someone owes you.
3. Record a reply without accidentally completing promises.
4. Mark a recurring bill paid without losing history, drifting its schedule, or creating duplicate successors.
5. Write notes offline, see Markdown preview, link records, and trust the save status.
6. Click an Orbit reminder while the app is visible, hidden, or exited and reach the correct current record.
7. If the optional updater is configured, check manually, download only on request, and install only after saves and data-safety preparation succeed.

### Scope table

| Track            | Required Week 12                                                                           | Boundary                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Weekly review    | Six steps, persistence, pause/resume, durable action receipts, completion summary          | No autonomous cleanup, automatic payments, or automatic plan acceptance     |
| People           | CRUD, commitments, direction/status filters, record contact/reply, follow-up integration   | No contact synchronization, email sending, or CRM pipeline                  |
| Bills            | CRUD for current bills, paid history, bounded recurrence, due-soon list, reminders         | No bank connection, payment execution, exchange rates, or accounting ledger |
| Notes            | CRUD, textarea editor, safe Markdown preview, links, reliable blur-save                    | No rich-text collaboration, attachments, image fetching, or full editor IDE |
| Navigation       | Real detail routes, strict Orbit links, toast activation, safe dirty-navigation handling   | Links navigate only; they cannot mutate records                             |
| Desktop          | Extend the Week 11 shell and close/quit preparation                                        | No duplicate resident implementation                                        |
| Optional updater | Manual-only UI, artifact signatures, safe install preparation, explicit feed configuration | No automatic checks/downloads, source publication, or credential embedding  |
| Week 13          | Preserve its hardening/mobile/encryption/release work                                      | Do not mark Week 13 complete because some regression checks run now         |

### Carry forward the honest Week 11 verification status

docs/RESIDENT-BEHAVIOUR.md records installed Windows notification identity, reboot/autostart, real single-instance forwarding, sleep/resume, upgrade/uninstall, and forced-termination scenarios as NOT RUN. MSI cleanup is still a stable-release gate.

Core Week 12 work can proceed, but installed notification routing is not complete until those relevant resident scenarios and the new click scenarios pass on a disposable Windows installation. A mocked desktop test is not a substitute.

## 2. Recommended execution order

| Order | Work package                                                         | Exit gate                                                                      |
| ----- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1     | Baseline, domain decisions, and short Windows activation spike       | Known constraints recorded; warm/cold toast route proved or blocker identified |
| 2     | WeeklyReview schema, bill compatibility, migrations, restore support | Old databases/exports load; new records round-trip safely                      |
| 3     | Transaction-safe commands and draft/navigation infrastructure        | Stale/repeated actions cannot lose changes or duplicate work                   |
| 4     | People and commitments                                               | Contact versus completion semantics verified with reminders                    |
| 5     | Bills and recurrence                                                 | Payment plus successor is atomic, idempotent, and auditable                    |
| 6     | Notes and canonical record routes                                    | Blur-save, conflicts, links, and dirty navigation work                         |
| 7     | Weekly review service and six-step UI                                | Resume, atomic progress, changed-data handling, and summary work               |
| 8     | Installed notification routing                                       | Correct current destination from visible/hidden/exited states                  |
| 9     | Full regression and installed Windows pass                           | Core Week 12 definition of done satisfied                                      |
| 10    | Optional updater                                                     | Separate hosting/key decisions and update-specific gates satisfied             |

People and Bills come before the full weekly flow so review steps reuse finished operations. Define review persistence early so these operations can record review progress atomically.

With two developers, domain/data work and the native activation spike can run in parallel after the contracts are agreed. Dirty-state ownership, repository generations, and navigation contracts remain shared foundations.

## 3. Baseline and architecture rules

### 3.1 Preflight

- Record HEAD, branch, git status, tool versions, and the existing test/benchmark results.
- Use checked-in lockfiles. Do not refresh unrelated dependencies.
- Distinguish existing failures from regressions before changing code.
- Protect old migration SQL and versioned fixtures.
- Prepare disposable test data, not changes to the user’s real people, bills, notes, or startup registration.
- Confirm a clean Windows VM/disposable account is available for activation and installer checks.
- Record updater deployment as optional and unconfigured until section 12 prerequisites are explicitly settled.

### 3.2 Reuse map

| Existing code                                                    | Reuse / required adaptation                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| packages/core/src/services/morning.ts and evening.ts             | Pure review calculations, not React-only persistence                               |
| apps/orbit/src/features/reviews/reviewService.ts and Stepper.tsx | Review presentation patterns and existing daily flows                              |
| packages/core/src/insights/dayLoad.ts and goalDeficit.ts         | Full-day booked load and separate area-target comparison                           |
| packages/core/src/recurrence/expand.ts                           | Original-anchor recurrence with monthly clamping; correct ordered weekly expansion |
| packages/core/src/rules/reminders.ts                             | Future queue calculation and stable reminder keys                                  |
| apps/orbit/src/features/reminders/reminderService.ts             | Owned-transaction queue reconciliation                                             |
| apps/orbit/src/features/inbox/inboxService.ts                    | Capture conversion, refactored for current-record validation and idempotency       |
| apps/orbit/src/features/structure/structureService.ts            | Project, task, next-action, and relationship operations                            |
| apps/orbit/src/components/LinkPicker.tsx                         | Link UI with transactional deduplication and lazy candidate loading                |
| apps/orbit/src/features/search/SearchPreview.tsx                 | Preserve existing preview links; add actual Open/Edit destinations                 |
| apps/orbit/src/features/structure/TaskEditor.tsx                 | Existing task editor, wrapped in a real task route                                 |
| apps/orbit/src/features/desktop/ResidentBridge.tsx               | Readiness-aware navigation and new pre-quit draft acknowledgment                   |
| apps/orbit/src-tauri/src/resident.rs and scheduler.rs            | Single ownership, readiness, delivery validation, safe shutdown                    |
| packages/storage/src/normalize.ts                                | Real read normalization, not schema defaults alone                                 |

### 3.3 Layering

- Core contains pure state transitions, queries, recurrence, and validation over arrays/records plus an injected clock.
- Storage/application services own repositories, transactions, conflict checks, and action receipts.
- React components own presentation and temporary drafts, not hidden business rules.
- Native code owns OS activation, notifications, update execution, and process lifecycle.
- One canonical destination resolver maps typed references to actual screens.
- One draft coordinator mediates navigation/quit/reload. Do not add a different unsaved-changes prompt to every entry point.

## 4. Data model and migration plan

### 4.1 New WeeklyReview record

Add a proper domain record/store. There is no existing persisted review entity to reuse.

Proposed fields:

- Base record: UUID, createdAt, updatedAt, deletedAt.
- reviewWeekStart: Monday of the local week being reviewed.
- targetWeekStart: the following Monday, frozen when the review starts.
- flowVersion: integer for future step-structure changes.
- revision: incrementing review revision for concurrency checks.
- status: inProgress, paused, or completed.
- currentStep: a stable identifier, not a numerical position.
- completedSteps and explicitly skipped/deferred step metadata.
- startedAt, pausedAt, completedAt.
- Per-step outcome/count metadata, with reviewed entity fingerprints referenced through the receipt store below.
- Small completion summary with counts, unresolved/deferred items, reviewed dates, and capacity totals.
- A versioned, bounded stepDraft for unsubmitted review choices, including their source references/base fingerprints. Saving this draft never applies a domain action or marks an item reviewed; Resume restores it for explicit Apply.

Step IDs: inbox, overdue, projects, goals, bills, capacity. The closing summary is the end of the six-step flow, not a hidden seventh step.

Store references, decisions, and summary values, not an entire duplicate database. Use bounded/pageable item UI. Avoid one unbounded transaction containing every review action.

Persist individual decisions in a companion WeeklyReviewAction store, keyed by the submitted action UUID. Each receipt carries reviewId, action kind, affected entity references, reviewed source fingerprints, choice/target, timestamp, and compact result. This avoids rewriting an ever-growing JSON array inside WeeklyReview for each action. Read receipts in pages and aggregate compact counts for the flow. Receipt creation and the domain mutation still share one transaction.

Treat receipts as immutable history after commit. A later correction is a new action referring to the earlier receipt, not an edit that pretends the earlier decision never happened. Do not cascade a review deletion into task/bill changes.

### 4.2 Review identity and lifecycle

- Permit one active/paused review per reviewWeekStart through a serialized start-or-resume transaction.
- Use UUID record identity. Do not use a date string as a record ID.
- A completed review is read-only history.
- An explicit “Review again” creates a new review record for the same week; it does not overwrite the previous completed summary.
- Opening a URL does not create a review or submit actions. The Start/Resume controls make the user’s intent explicit.
- If an older unfinished review exists, show its dates and offer Resume or Start this week. Do not silently relabel or abandon it.
- Resuming after Monday retains the original review/target weeks and warns that the period is older.
- Define deterministic handling for imported duplicate active reviews: preserve every record, choose one canonical active candidate, and present recovery/resume choices. Do not silently merge conflicting action histories.
- A URL with a review ID resolves that exact live record or shows a safe missing/deleted state.

### 4.3 Bill occurrence additions

Keep Bills as occurrence records; a separate bill-series store is not necessary for this milestone.

Add defaulted fields:

| Field            | Purpose                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| seriesId         | Stable UUID grouping an original schedule’s occurrences; null for a one-off bill                                           |
| recurrenceAnchor | Original schedule date; never reset to a clamped February date                                                             |
| occurrenceIndex  | Zero-based generated position under the original schedule                                                                  |
| scheduledFor     | Original occurrence date, separate from an edited payment deadline                                                         |
| paidAt           | Actual recorded payment timestamp; nullable for legacy paid history                                                        |
| nextBillId       | Persisted link to the one generated successor                                                                              |
| repeatStopped    | Explicitly stops future generation from this occurrence while preserving its recurrence description/history; default false |

The original recurrence parameters, including COUNT, travel with the chain. Validate field combinations, finite values, valid dates, UUIDs, and nonnegative indices.

Old recurring records normalize as roots anchored at their existing dueAt, with scheduledFor equal to dueAt and occurrenceIndex zero. Use the existing bill ID as the stable legacy series identity. Missing paidAt on an already-paid bill remains “payment time not recorded”; never invent a historical payment timestamp.

Normalization must not automatically generate overdue bills, claim past payments happened now, or start network/OS actions.

### 4.4 Actual schema changes

Expected versions after adding WeeklyReview and its action-receipt store:

- SQLite: 3.
- IndexedDB: 4.
- JSON export: 5.

Add weeklyReview/weeklyReviews and weeklyReviewAction/weeklyReviewActions consistently to entity types, store maps, schema registries, every adapter, import/export, seed/test builders, operation-log handling, diagnostics counts, and native table allowlists. Index receipt lookup by reviewId and time; action UUID identity provides the idempotency lookup.

Migration requirements:

1. Append SQLite migration 3 and IndexedDB version 4. Never modify the emitted SQL of migrations 1/2.
2. Freeze version-specific store inventories; extending today’s Repository type must not accidentally add WeeklyReview to migration 1’s generated table list.
3. Add sensible week/status lookup indexes without relying on an index that only one adapter honors for correctness.
4. Extend actual read normalizers for old Bill records.
5. Old JSON exports without weeklyReviews/weeklyReviewActions default to empty stores. Import validates the new review/receipt shapes and lineage references; absent referenced data is reported safely, not silently recreated.
6. Export version 5 includes reviews and bill metadata; versions 1–4 remain readable.
7. Generate new SQLite 3, IndexedDB 4, and export 5 fixtures without overwriting old fixtures.
8. Test the operation-log/search/undo switches against the new entity. Reviews must not accidentally become searchable notes or generic reversible payment commands.
9. Prevent older applications from opening a newer physical schema, preserving the current newer-schema refusal.
10. Retain machine-local native preferences outside domain exports.

### 4.5 Old backup restore is a separate gate

The native restore verifier currently allows missing reminders/appSettings only for schema-1 backups. Adding the new live review tables would otherwise cause valid old schema-1/2 backups to be rejected.

Change expected/missing-table validation to derive from the backup’s own schema version, then restore and migrate through the normal path. Test a real old backup file, not only in-memory row conversion.

Required matrix:

- SQLite 1 → 3 and 2 → 3.
- IndexedDB 1/2/3 → 4.
- Export 1/2/3/4 → 5.
- Current-format lossless round trip.
- Actual old SQLite backup → restore → migrate → open review/people/bills/notes.
- Failed migration/restore leaves the original usable database intact.
- Restore while forms are mounted invalidates stale drafts and repository generations safely.

## 5. Transaction-safe mutations and durable progress

### 5.1 Refactor the shared mutation boundary

Existing helpers sometimes read records before acquiring a transaction or spread a stale component record into an upsert. Do not reproduce that pattern in Weekly Review.

Provide transaction-safe helpers, with thin UI wrappers:

1. Acquire the owned transaction.
2. Re-read current records and relationships through tx.
3. Compare the fields/revision the user acted upon.
4. Validate permissions within the domain: live entities, status, parent relationship, next-action eligibility.
5. Perform the domain mutation.
6. Reconcile affected reminder rows using the same transaction-safe helper when relevant.
7. If invoked from a review, append its action receipt and update progress/revision in that transaction.
8. Commit, then publish data-change/UI notifications.

Only use tx inside the callback; never call the root repository while retaining its transaction. Do not show success, advance steps, or bump data before commit.

Refactor only the operations required by Week 12, while running the existing Inbox, Morning/Evening, Projects, command, and undo regressions.

### 5.2 Idempotency

Each mutating review submission receives a stable action ID generated when the user submits. Retrying an uncertain request reuses that ID.

- Existing receipt belonging to this review and matching action payload: return the stored result without repeating the mutation. Reusing an action ID for a different review or payload is a validation error, not a successful replay.
- Already-processed capture: return its existing processed reference, not a second task/bill/person.
- Already-paid bill: return its existing successor/result.
- Existing link: return the canonical link.
- Repeated Finish: return the same completed review.
- A failed transaction creates neither the result nor its receipt.

Disable repeated buttons in the UI, but do not rely on button state for correctness across windows.

### 5.3 Conflict behavior

- A stale review revision prompts refresh/retry and preserves unsaved input.
- An entity changed after it was inspected is reloaded and marked “Changed since reviewed.”
- Compare relevant captured field values as well as timestamps where necessary; same-millisecond writes must not evade detection.
- Merge independent field edits when safe. Never overwrite a changed note body or bill schedule with a stale whole record.
- Deleted records produce a meaningful unavailable result. No edit should resurrect them accidentally.
- Action receipts are history, not permission to replay old choices after a restore or an external mutation.
- Keep new domain operations out of generic command undo unless their complete grouped, conflict-aware undo contract is deliberately implemented. Explicit Reopen/Restore actions remain available where specified.

## 6. Save safety and canonical navigation

### 6.1 Draft coordinator

Register dirty forms by stable record/window identity, with:

- current dirty state and save status;
- an awaited save/flush operation;
- validation/conflict/error information;
- explicit discard support;
- a repository generation and base-record version/fingerprint.

Cover Notes, Weekly Review temporary inputs, People/Bill forms, and existing capture/task drafts reached through the new navigation paths.

A “Saved” label means the durable commit succeeded. Failed saves retain their draft and a visible Retry path.

### 6.2 Router prerequisite

The app currently uses BrowserRouter and tests use MemoryRouter. The installed React Router blocker depends on a data router; simply inserting useBlocker is not sufficient.

Plan a small migration to createBrowserRouter/RouterProvider and matching createMemoryRouter tests, preserving the current route tree, provider lifetimes, first-run behavior, capture window, and lazy chunks. Do not recreate the repository or reminder providers on every navigation.

Use one Save / Discard / Stay guard for app navigation, including Back/Forward, nav rail, palette, links, and incoming native navigation. React Router’s blocker covers SPA transitions, not document reload or cross-origin exits. [React Router useBlocker](https://reactrouter.com/api/hooks/useBlocker).

### 6.3 True exit, hidden windows, and reload

- Hide-to-tray keeps drafts/providers alive; it is not an implicit discard.
- Before actual Quit, request a bounded draft flush/ack from every relevant live window before native database shutdown starts.
- Main and capture acknowledgments carry request and database-generation IDs. Ignore stale acknowledgments.
- Save failure, conflict, or missing acknowledgment leaves the app reachable and cancels the quit/update attempt.
- If hidden capture contains text, offer Save capture / Discard / Cancel. Do not silently convert its text into a domain record.
- Browser unload gets the browser’s unsaved-data warning when appropriate. Do not promise that beforeunload can await database writes.
- Route the PWA’s existing “Reload” update action through the same draft guard.
- An OS kill cannot be made transactional with an unsaved textarea. Document that only acknowledged saves/progress survive forced termination.

### 6.4 Canonical routes

| Reference       | Destination                                                            |
| --------------- | ---------------------------------------------------------------------- |
| person          | /people/:id                                                            |
| commitment      | /people/:personId?commitment=:id, resolved from the current commitment |
| bill occurrence | /bills/:id                                                             |
| note            | /notes/:id                                                             |
| task            | /tasks/:id using a route wrapper around TaskEditor                     |
| project         | Existing /projects/:id                                                 |
| goal            | Existing /goals/:id                                                    |
| review          | /review/weekly?review=:id                                              |
| timeline block  | Existing /timeline?date=YYYY-MM-DD&block=:id                           |

Keep /search?open=type:id previews working. Add Open/Edit actions to actual detail screens rather than breaking saved Week 10 URLs.

Update search, linked panels, insight evidence, Markdown links, reminders, and commands to use the same typed resolver. Missing/deleted records never silently redirect to a different record.

## 7. People and commitments

### 7.1 People list and detail

Replace the placeholder with:

- Search/filter by name; stable alphabetical ordering with an ID tie-breaker.
- Person creation and editing of name/contact.
- Counts split into “I owe” and “Owed to me.”
- Detail with open/done/dropped commitments, contact history’s existing last-contact value, and follow-up status.
- Exact commitment highlighting when opened through evidence/reminder links.
- Empty/loading/error/deleted-person states.
- Existing linked records via the shared link component.

The ≥3 commitment badge must use Week 11’s count semantics, not a third independent count function.

### 7.2 Commitment operations

- Create requires a live person, nonempty text, explicit direction, and optional valid dueAt.
- Edit text, due date, and direction with fresh-record conflict checks.
- Mark done and Drop are separate actions; Drop is not a payment or a completed promise.
- Reopen is explicit and reconciles follow-up state.
- Display nullable due dates honestly.
- Completing an owed-to-me commitment removes it from follow-up eligibility.
- Do not automatically mark every commitment done because the person replied.

### 7.3 Record reply/contact: deliberate person-level semantics

Use existing Person.lastContactAt; no commitment-specific reply field is necessary for this milestone.

Action label: “Record reply/contact.”

Explain before applying: “Updates last contact for this person and restarts follow-up timing for all open commitments owed to you. It does not complete any commitment.”

- Default timestamp is the injected current time; allow a valid explicit past timestamp.
- Do not silently move a newer last-contact timestamp backward. An explicit correction is a separate confirmed edit.
- Repeating the same timestamp is a no-op, not a new notification episode.
- Keep “Mark commitment done” separate.

Follow-up baseline must be the later valid value of commitment.createdAt and person.lastContactAt. A person’s old contact date must not make a newly created commitment immediately overdue.

Preserve the existing calendar-date quiet period and 09:00 local reminder time. A same-date reply may keep the same reminder key; preserve terminal fired/dismissed history and document that behavior rather than inventing instant-by-instant duplicate reminders.

Update TypeScript queue computation and Rust pre-delivery validation together:

- missing/deleted person → no follow-up;
- open owed-to-me only;
- old pending keys cancel and new eligible keys queue atomically with contact/source changes;
- cancelled pending tombstones may revive;
- fired/dismissed history never revives.

### 7.4 Deletion policy

- Person deletion is a confirmed soft deletion, showing the count of affected commitments.
- Preserve related commitment and link records for history/recovery; hide their active surfaces and suppress their follow-ups while the person is deleted.
- Do not silently transfer promises to someone else or mark them done.
- Provide a Deleted view/Restore action for the person. Restoring shows its still-open commitments and reconciles reminders using the existing terminal-key rules.
- Commitment deletion soft-deletes only that commitment; deleting one promise must not delete the person.

### 7.5 People tests

- Both directions, mixed counts, exact 2/3 badge boundary.
- Create/edit/complete/drop/reopen and fresh-record validation.
- Reply with two open owed-to-me commitments; neither becomes done.
- New commitment with older contact timestamp.
- Same-day contact and later quiet-period keys.
- Deleted/missing people and restored person.
- Contact write fails midway: neither source nor queue partially commits.
- Visible/hidden native delivery rejects obsolete reminders.
- Evidence/deep link opens the exact commitment.

## 8. Bills, paid history, and recurrence

### 8.1 Screens and query semantics

Replace /bills with a real list and /bills/:id with a detail/editor.

Default groups:

- Overdue: unpaid, live bills with dueAt before today.
- Due soon: unpaid bills from today through today + 3 local dates, inclusive.
- Upcoming: later unpaid bills.
- Paid history: paid occurrences, grouped/filterable by series.
- Deleted: explicit recovery view, separate from active totals.

Show title, amount, currency, due date, recurrence description, and reminder status. Clicking a recurring item opens that occurrence, not whichever installment is newest.

- Validate finite nonnegative amounts. Do not send or execute payments.
- Preserve existing decimal amounts without a surprise money-schema conversion.
- Show totals per currency; never add USD and JOD into one unlabeled number.
- An empty currency remains “currency not set,” not an invented default.
- Due-soon highlighting is a fixed three-date product rule, distinct from configurable reminder-rule lead time. Label both clearly.
- Recompute date-sensitive groups at local midnight and focus/resume.

### 8.2 Mark paid is one atomic domain operation

In one owned transaction:

1. Read the current live bill.
2. If already paid, return its existing payment/successor result; do not generate another occurrence.
3. Validate the action’s base state and permitted changes.
4. Set paid=true and paidAt to the submitted/injected timestamp.
5. If recurrence continues, find the next scheduled occurrence using its original anchor/rule/position.
6. Create at most one next Bill with a new UUID and carried series metadata.
7. Persist nextBillId on the paid occurrence.
8. Cancel obsolete pending reminders and prepare the successor’s future reminders.
9. If invoked from Weekly Review, record its action receipt and progress atomically.
10. Commit before reporting success.

Any failure between these writes rolls everything back, including operation-log entries.

Paid rows retain their identity, original amount/currency/due date, and payment timestamp. Do not advance dueAt on the same paid row and set paid=false again; that loses history.

### 8.3 Recurrence definition

- Reuse the Week 6 recurrence engine, not a separate date loop in the Bills UI.
- Carry original recurrenceAnchor, COUNT, and UNTIL through successors.
- occurrenceIndex is zero for the first generated occurrence; COUNT=1 therefore allows index zero only. Count remains relative to the original rule, not the number of times Mark paid was clicked.
- scheduledFor records the original schedule date; dueAt may be an explicit override for that installment.
- Find the next scheduled date after scheduledFor, not after the payment timestamp or edited deadline.
- Generate only one successor per payment.
- A late payment generates the next scheduled occurrence even when that next occurrence is already overdue. Do not skip missed bills to jump to today.
- Stopping at COUNT/UNTIL produces no successor and a clear “Series finished” state.
- Never run unbounded expansion until an arbitrary distant date.

Use a bounded next-occurrence helper that returns either the next date/index, exhausted, or a validation error. Base bounds on the supported rule semantics, not a silent one-year cutoff that would miss a valid long interval.

On creation, preview the first occurrence and next two dates. Require the first scheduledFor to agree with the selected weekday/month-day rule, or ask the user to adjust the first date/rule explicitly. Validate supported calendar bounds and arithmetic overflow; an invalid extreme interval must not hang expansion or be misreported as a finished series.

### 8.4 Correct the shared weekly ordering first

The existing recurrence engine uses Monday-based weeks but sorts JavaScript weekday indices with Sunday first. Its early stop at range.to can consequently miss an earlier Monday in a narrow Sunday+Monday query.

Correct candidate ordering to chronological order within the chosen week and normalize duplicate weekdays before relying on the helper for bills. Keep this a shared correctness fix and run routine recurrence regressions too.

Required examples:

- Monthly January 31 → February 28/29 → March 31.
- Monthly interval greater than one retains the original anchor.
- COUNT=1 creates no successor after the first payment.
- UNTIL is inclusive.
- Sunday plus Monday in a narrow range returns the correct next chronological date.
- Duplicate weekdays do not consume COUNT twice.
- Very late payment does not silently erase missed installments.
- An edited dueAt does not drift later scheduledFor dates.

### 8.5 Editing, stopping, deleting, and correcting

Current unpaid occurrence:

- Title, amount, and currency changes propagate to the successor generated from it.
- A due-date edit changes only that occurrence’s deadline; scheduledFor/anchor remain stable.
- Show a recurrence summary so “this bill” and “future schedule” are not confused.
- Stop repeating sets repeatStopped on the latest unpaid occurrence. It does not erase the recurrence definition, delete that unpaid bill, or change paid history. New successors begin with repeatStopped=false; a stopped occurrence generates no successor.
- Once a series has begun, changing its recurrence pattern is an explicit new-series operation, not an in-place rewrite of historical COUNT/anchor. For this milestone, offer Stop repeating plus creation of a new recurring bill with a chosen future start, clearly previewing any overlap.
- Do not silently rewrite already-generated later occurrences when editing an earlier record.

Paid history:

- Read-only by default.
- No generic recurring paid/unpaid toggle that can duplicate successors or remove a later genuine payment.
- A one-off payment correction can explicitly return the occurrence to unpaid and clear paidAt through a validated action.
- Reversing a recurring payment with a successor is outside the thin Week 12 flow unless a fully tested grouped reversal is added. Explain the limitation; do not expose a misleading Undo button.
- Retrying an old parent payment never resurrects a deliberately deleted successor.

Deletion:

- Confirm and soft-delete the selected occurrence only, retaining its lineage and link records.
- Stop repeating is a distinct action; deleting history is not a “stop subscription” shortcut.
- If the latest unpaid occurrence is deleted, generation stops because there is no payable source. Explain this before deletion.
- Restore is explicit and follows normal reminder deduplication. It must not generate new history on read.

Legacy paid recurring rows with no successor:

- Do not advance them automatically during migration, page load, or retry of an already-paid action.
- Offer an explicit “Create next occurrence” recovery action after showing the assumed legacy anchor.
- Use the same transactional successor lookup/link and idempotency policy as Mark paid.

### 8.6 Bill tests

- One-off create/edit/delete/restore/pay and nullable legacy payment time.
- Exact due-soon endpoints and midnight rollover.
- Mixed currencies and zero amount.
- Monthly clamp, leap year, weekly ordering, duplicates, intervals, COUNT/UNTIL.
- Early/late payment and changed deadline.
- Double-click, retry after uncertain response, and concurrent payments from two windows.
- Failure after paid write but before successor/reminder/receipt write: complete rollback.
- Stop repeating, deleted successor, explicit legacy advancement.
- Export/restore and retry preserve one successor and correct history.
- Paid/source changes prevent an obsolete native notification from firing.

## 9. Notes and safe offline editing

### 9.1 Notes list and detail

Use the existing Note fields: title, body, projectId, areaId. Notes already have storage/search/export support; no new Notes table is needed.

- /notes: search/filter by title, area, and project; newest updated first with stable tie-breaker.
- /notes/:id: title, body editor, preview, assignment, linked records, save state, delete/restore.
- New note requires a title; an empty body is valid.
- Deleted/missing note shows an explicit state rather than silently creating a replacement.
- Keep existing search snippets and previews functional; add Open/Edit navigation.

Parent assignment:

- Selecting a project derives the note’s area using a named, tested note-parent policy.
- Do not save contradictory project/area pairs.
- Existing notes in archived projects remain readable/editable.
- New assignment to a deleted/archived project is blocked.
- Missing imported parents show “Unavailable project”; the note body is preserved.
- Linking a note to a project and assigning its parent project are different operations.

### 9.2 Editor choice and preview policy

Use a textarea plus lazy, locally bundled react-markdown. Do not add CodeMirror/MDX complexity to this milestone.

The library renders React elements; safety still depends on plugins and URL handling. Keep raw HTML disabled, omit raw-HTML/MDX plugins, and implement a restrictive link/image policy. [Official react-markdown documentation](https://github.com/remarkjs/react-markdown).

Requirements:

- Headings, lists, emphasis, blockquotes, code, and ordinary links render correctly.
- No scripts, iframes, executable HTML, or dangerouslySetInnerHTML path.
- Do not load remote images, local file images, avatars, fonts, or embeds from note content. Render alt text/placeholders.
- Internal Orbit links go through the same typed parser/resolver.
- External links open only after user action and scheme validation.
- Reject javascript:, data:, file:, UNC paths, unknown schemes, encoded bypasses, and protocol-relative surprises.
- Keep the desktop CSP intact.
- Store the body losslessly; do not save rendered HTML or rewrite Markdown during preview.
- The existing Markdown exporter generates documents; it is not a preview sanitizer.

### 9.3 Autosave contract

- Save dirty fields on blur.
- Also provide an explicit Save button and Ctrl+S when the editor owns focus.
- Show Editing / Saving / Saved / Failed / Conflict states.
- Serialize writes per note.
- Capture the note ID, base fields, generation, and draft version for each save.
- Re-read the current note in an owned transaction and compare the fields being changed.
- Apply only the intended patch, not an old complete Note object.
- A late response may update the saved base for its version, but cannot replace text typed after it began.
- A background data refresh must not overwrite a dirty draft.
- Empty title fails validation, keeps the draft, and never displays Saved.
- On storage failure, preserve the draft and allow retry/copy.
- On conflict, retain both the user’s draft and current saved version; offer reload, copy, or Save as a new note. Do not silently overwrite.
- Block a save against an externally deleted note; allow copying the draft into an explicitly created new note.

One successful blur-save is one potential undo unit, not one operation per keystroke. Existing command undo does not automatically track direct service writes: either deliberately integrate a grouped conflict-aware note edit command or do not advertise global Undo for it.

### 9.4 Link picker and relationship integrity

- Reuse LinkPicker and core duplicate/self-link helpers.
- Load candidates when the picker opens, not on every closed render.
- Support loading/error/pending states and prevent double submission.
- Validate both live endpoints inside the same transaction as link creation.
- Detect duplicate links in either direction with the same link type.
- Unlink soft-deletes the relationship, not the linked record.
- Deleting a note preserves relationship records so a restore can recover them; linked panels filter missing/deleted endpoints.
- Paginate/limit rendering while retaining access to all matching candidates.

### 9.5 Notes tests

- Create → type → blur → committed Saved → reopen.
- Empty body, invalid title, parent-derived area, missing/deleted parent.
- Reversed save-response order, same-millisecond conflicts, external edit/delete.
- Storage failure retains text; no false success notification or premature data bump.
- Save/Discard/Stay for note switching, Back/Forward, palette, tray route, reminder click, and Quit.
- Hidden main keeps the draft; capture and main saves coordinate before true exit.
- Markdown malicious HTML, encoded schemes, images, malformed syntax, large body.
- Assert no network request merely from viewing an imported note.
- Duplicate/reversed/self links, target deletion race, delete/restore relationships.
- Search refresh after rename/edit/delete; JSON round-trip retains body exactly.

## 10. Weekly review service and six-step flow

### 10.1 Starting and resuming

Add a useful /review/weekly landing state:

- Start this week.
- Resume an unfinished review, showing its fixed dates and saved step.
- View completed summaries.
- Review again explicitly, creating a new attempt.

Enable the Week 10 weekly-review command capability only when the route works. Remove the “arrives in week 12” notice. Add a Today launcher without breaking the existing morning/evening conditions.

Start stores the local current week and following target week. Live entity data is refreshed throughout; period identity stays fixed.

Pause commits the current step/progress and validated pending choices into stepDraft before returning. Those unsubmitted choices do not mutate their task/bill/goal until the user explicitly applies them. Invalid drafts require Save/Discard/Stay; “Paused” is not displayed before persistence succeeds.

### 10.2 Step completion policy

This is a guided review, not a forced cleanup engine:

- Required items must be acted upon, acknowledged, or explicitly deferred.
- Empty steps can be acknowledged and advanced.
- “Defer” keeps the unresolved item and records that decision; it does not fake a healthy state.
- Optional reasons can explain deferrals; completing a review must show the unresolved count.
- Back navigation never reverses committed changes.
- Editing an earlier step updates live data and may invalidate later acknowledgments.
- No transaction remains open while the user reads a screen.
- Before Finish, recheck relevant fingerprints and identify new/changed items; ask for acknowledgment/revisit rather than silently certifying stale work.

Use an accessible stepper with named headings, completion/deferred text, stable focus, and save/error status. Adapt the current Stepper so “everything before current index is done” is not the source of persisted truth.

### 10.3 Step 1 — Inbox

Show the actual Capture inbox and untriaged Task inbox as separate groups. Do not equate capture count zero with every task being triaged.

Actions:

- Review/reclassify a capture and convert using existing entity-specific prompts.
- Assign the required project/area/person.
- Archive a capture explicitly.
- Open/triage an inbox task or defer it.
- Return from an editor to the same review/step.

Capture conversion plus processed reference plus review receipt must commit together. An already-processed capture returns the original reference on retry.

Gate: current items are processed, archived, triaged, or explicitly deferred. Summary includes any remaining inbox items.

### 10.4 Step 2 — Overdue work

Use live unfinished tasks with valid dueAt earlier than the current injected clock. Preserve the distinction between an Instant deadline and a LocalDate bill.

Show due date, priority, project, current block/acceptance context, and blocking dependencies.

Choices:

- Reschedule to an explicit date/time using existing date rules.
- Return to inbox, explicitly clearing/changing the deadline according to the chosen action.
- Archive/drop the task, with confirmation of what will change.
- Mark complete through the existing completion/timer workflow.
- Keep/defer with acknowledgment.

Record the chosen action and target. Do not automatically accept a suggested rollover for every overdue task.

Rescheduling changes a deadline, not an existing Timeline block. If the block remains on its old date, say so and provide a Timeline link rather than silently moving locked/manual blocks. Archive must clean up or invalidate dependent next-action/commitment references through the established domain policy.

Gate: each currently displayed overdue task is resolved or explicitly deferred; no completion or new plan is implied.

### 10.5 Step 3 — Projects

Inspect every live active project using shared Week 11 health:

- Outcome, progress, next action.
- Blocked, stale, no-next-action, and overdue signals.
- Relevant tasks and milestones.
- Last activity and evidence.

Actions:

- Set a next action from a live eligible unfinished task belonging to that project.
- Create a task and select it as next action in the same owned transaction.
- Edit outcome/details using a conflict-aware patch.
- Archive with the existing cascade preview/confirmation.
- Acknowledge or defer inspection.

Revalidate next-action ownership/status at save time. Recompute health immediately after commit so the cleared flag is visible.

A task modified in another window while the project is being inspected invalidates the relevant acknowledgment. A project archived/deleted elsewhere is reported as changed, not recreated from a stale form.

Gate: each current active project has a review decision. “Inspected” does not mean “all health warnings fixed.”

### 10.6 Step 4 — Goals and area targets

Show active goals, importance, target dates, goal attention, and associated area weekly targets.

Actions:

- Update importance/target date.
- Mark achieved or dropped explicitly.
- Edit the area’s weekly-hours target in its own clearly labeled control.
- Inspect linked projects and return.
- Acknowledge/defer.

Reuse current neglected-goal semantics and badges. Goals do not acquire invented per-goal required-hours fields.

Gate: active goals reviewed or deferred; changed targets refresh the later capacity check.

### 10.7 Step 5 — Bills

Embed the Bills query/actions, not a second implementation:

- Show unpaid overdue bills and bills due through the frozen target week’s end.
- Show recurring schedule and recent paid history where helpful.
- Mark paid atomically, with a visible successor/result.
- Open detail to edit or stop future repetition.
- Defer a bill without marking it paid or dismissing its reminder automatically.

New successors generated by payment are shown as new items when they fall inside this period. Do not automatically pay them or silently omit a newly overdue installment.

No fake task is created merely because a bill needs attention.

Gate: bills in scope are paid, edited, acknowledged, or explicitly deferred.

### 10.8 Step 6 — Next-week capacity

Use the review’s frozen targetWeekStart through targetWeekStart + 6 days.

Display two separate comparisons:

1. Booked/accepted work versus available time.
2. Area weekly targets versus available time.

For booked work:

- Call the shared computeDayLoad for each target date, even outside the global Insights seven-date horizon.
- Sum its committed minutes and full-day capacity for the weekly totals.
- Flag weekly booked demand > weekly capacity.
- Also show daily warnings using the saved Week 11 overload threshold (default strictly above 110%). Label thresholds; a weekly total that fits does not hide an overloaded individual day.
- Include accepted-unscheduled tasks and exact contributing blocks under the existing rules.

For area targets:

- Count every live area target once.
- Factor a shared helper that accepts an explicit week, rather than calling a next-week-from-now wrapper after the review has been resumed weeks later.
- Do not add area target hours on top of booked work. Some booked work fulfills those same targets.
- Keep the existing seven-day working-window/weekend/reservation explanation.
- Both comparisons exclude transition buffers and are not proofs of feasible allocation across gaps, areas, or energy constraints.

Actions are read-only drill-down or explicit edits through their real screens. Opening “Plan this day” may produce a proposal; it must not accept or overwrite a plan.

Gate: recomputed current numbers are acknowledged, and any unresolved overload/deficit is included in the summary.

### 10.9 Finish and history

Before completing:

- Flush valid drafts and ensure no write is pending.
- Recheck review revision and relevant item fingerprints.
- Present resolved/deferred/new-or-changed counts.
- Ask for explicit acknowledgment of unresolved items.
- In one transaction, set completed status/time and persist a compact summary.

The completion summary is a historical record of what was reviewed and decided. It does not silently change when tomorrow’s tasks change.

Store:

- Review and target dates.
- Step outcomes and action counts.
- Deferred/unresolved references.
- Final booked/area-target/capacity totals and computation timestamp.
- Link to the durable decision history.

Repeated Finish returns the same completed record. Abandoning the screen does not undo committed actions. Review deletion, if offered, soft-deletes review history only and never reverses domain work.

### 10.10 Weekly review tests

- Start/pause/reload/resume each of six steps.
- Monday rollover keeps both stored periods unchanged.
- Old unfinished versus new current-week review; completed Review again preserves history.
- Repeated action ID, conversion, payment, and Finish are idempotent.
- Failure between entity mutation and progress receipt leaves neither partial result.
- Two-window review revisions conflict safely.
- New/changed/deleted source records invalidate only relevant acknowledgments.
- Next-action validation and health update.
- Overdue reschedule/drop/defer choices recorded correctly.
- Bills and late generated successors remain visible as appropriate.
- Daily overload with weekly spare capacity; separate target versus booked totals.
- Export/import/backup restore resumes correctly.
- Morning/evening flows and palette navigation remain working.

## 11. Windows notification activation and deep links

### 11.1 Prove the platform path before building the final UI

The installed notification plugin currently forwards only basic notification fields on desktop and does not provide the Windows click contract the roadmap assumes. Its underlying asynchronous display path also does not expose a trustworthy immediate enqueue result to the current scheduler.

Adding the deep-link plugin alone will not attach a launch payload to an existing toast. Tauri’s notification action APIs are platform-specific; Windows activation must be verified separately. [Notification documentation](https://v2.tauri.app/plugin/notification/).

Use a bounded one-day implementation spike:

1. Send an installed Orbit toast carrying a typed reminder destination.
2. Click its body with main visible.
3. Repeat with main hidden.
4. Exit Orbit and click the retained notification-center item.
5. Verify one process opens the exact current record.
6. Inject immediate native display failure and observe a retryable pending row.

Recommended first implementation path: a narrow Windows notification backend using protocol activation and the registered Orbit URI handler. A warm-only callback is insufficient for clicks after the process has exited. Microsoft’s toast schema defines launch/activation context; prove the selected API in an installed build before committing to it. [Windows toast schema](https://learn.microsoft.com/en-us/uwp/schemas/tiles/toastschema/element-toast).

If the spike cannot meet cold activation, record the exact blocker and alternative; do not mark routing complete with a development-only demo.

### 11.2 Typed URI contract

Supported examples:

- orbit://reminder/<uuid>
- orbit://task/<uuid>
- orbit://person/<uuid>
- orbit://commitment/<uuid>
- orbit://bill/<uuid>
- orbit://note/<uuid>
- orbit://review/<uuid>

Prefer a reminder UUID in actual notification payloads, then resolve the current reminder/entity relationship from local data.

Parser requirements:

- Exact supported scheme and target kinds.
- Valid UUIDs and expected segment counts.
- A conservative input length bound.
- Reject credentials, ports, fragments, unexpected query parameters, unknown actions, encoded path separators, and double-decoding tricks.
- No titles, note bodies, contact text, financial amounts, database paths, or secrets in the URI or logs.
- A link only navigates. It cannot mark paid, complete a task, record contact, import data, accept a plan, or run a command.
- An incoming URI cannot switch the data directory or open an arbitrary webview URL.

For a missing reminder, show a useful missing-record message and safe landing page. For a paid bill or completed commitment, open its current historical/completed state rather than inventing another outstanding item.

### 11.3 Warm, cold, and forwarded activation

Keep single-instance registration first. Add the deep-link integration/forwarding support without bypassing resident ownership.

Handle:

- Initial launch URI.
- New URI events while running.
- Second-instance forwarded URI.
- Navigation queued while main/database/router are initializing.
- Readiness for the current database generation only.
- Incoming activation while an editor is dirty.
- Repeated delivery of the same activation through more than one API.

Deduplicate duplicate event delivery for one activation, not all future clicks on the same URI. A later deliberate click should still focus/open the record.

An explicit notification activation takes precedence over background-launch hiding. Show/unminimize/focus the existing main window, then use the draft guard and typed resolver. Never create another database owner or scheduler.

The deep-link plugin documents initial/current links and incoming events; its single-instance integration must be configured deliberately. [Tauri deep linking](https://v2.tauri.app/plugin/deep-linking/).

### 11.4 Delivery status and crash boundaries

The native notification abstraction should return a real immediate Windows submission result.

- Submission failure: remain pending and retry within the existing bounded scheduler policy.
- Successful OS submission: record fired using existing source/key validation.
- Fired means submitted, not read by the user and not proof of a visible toast.
- Preserve fired/dismissed terminal history and cancelled-pending revival.
- Retain the 20-per-pass cap and fair backlog processing.
- Use a stable Windows notification tag/group derived from reminder identity where supported, to reduce duplicate notification-center entries.

The OS notification and SQLite commit are not one atomic transaction. A crash after submission but before recording fired can cause a retry. Document this boundary and test recovery; do not claim mathematically exact-once visible delivery.

Keep titles/body out of diagnostics and keep the existing Do Not Disturb/notification-settings explanation.

### 11.5 Registration and installed verification

- Production identity remains app.orbit.desktop.
- Register the Orbit protocol through the supported NSIS integration.
- Confirm registration ownership before replacing/removing an existing handler.
- Quote executable/URI arguments correctly.
- Upgrade preserves the intended handler, autostart state, and current executable target.
- Uninstall removes only registrations owned by this installation, not another application’s handler or user data.
- Automated tests use an isolated identity/scheme and fake registration; never register production Orbit against the developer’s profile.
- MSI remains a separate stable-release gate.

Required installed scenarios: visible, hidden, booting, exited, duplicate process, dirty editor, deleted target, paid/completed target, upgrade, uninstall, and immediate OS failure.

## 12. Optional updater — separate implementation and deployment gates

### 12.1 Keep the existing distribution decision

Windows installers remain unsigned by the existing Authenticode decision. Tauri updater artifact signing is a separate requirement.

The standard updater verifies downloaded installer artifacts against an embedded public key. The HTTPS manifest contains metadata and artifact signatures; do not call it an independently signed manifest. [Tauri updater documentation](https://v2.tauri.app/plugin/updater/).

This optional track must not block local People/Bills/Notes/Review work. Until configured, Settings says “Updates are not configured” and offers the established manual-install guidance; it must not contact a fabricated endpoint.

### 12.2 Hosting decision before production enablement

The configured GitHub origin, Jallad209/Orbit-, is private. Anonymous users cannot download its private manifest/assets.

Recommended choice, requiring explicit owner approval during implementation:

- Keep source private.
- Use a separate approved public artifact repository or static HTTPS feed for release binaries/metadata.

If binaries must also remain private, an authenticated distribution design is a separate scope/identity decision. Do not embed a GitHub token, private-repository credential, or shared download secret in the app.

Do not create a public repository, change source visibility, buy hosting, configure secrets, or publish releases merely to complete this planning task.

Alpha/beta feeds must be explicit. GitHub’s ordinary latest-release selection excludes prereleases and drafts, so it is not a complete channel strategy for the current alpha build. [GitHub latest-release API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release).

Define an approved endpoint and allowed artifact hosts per channel. Keep assets versioned/immutable and update the channel pointer only after all matching artifacts are available and verified.

### 12.3 Keys and build configuration

Once authorized:

- Generate the updater signing key outside the repository and back it up securely.
- Put only the public key in app configuration.
- Supply TAURI_SIGNING_PRIVATE_KEY and its optional password through protected release secrets.
- Enable createUpdaterArtifacts in the release/test overlay; ordinary local development must not require production secrets.
- Never log private key contents, passwords, or secret-bearing URLs.
- Document key ownership, encrypted backup, and a rotation/recovery path.
- Key loss or replacement can strand clients trusting the old key. Plan a compatible bridge release or manual reinstall; do not silently replace the feed’s signing key.

Prefer NSIS updater artifacts while the MSI channel is unverified. Explicitly configure the release action’s manifest/signature outputs and NSIS preference rather than relying on bundle ordering. Validate against the action version actually pinned in the workflow. [Official Tauri action inputs](https://raw.githubusercontent.com/tauri-apps/tauri-action/dev/action.yml).

### 12.4 Runtime state machine

States:

unconfigured → idle → checking → upToDate / available / error → downloading → verified → preparing → installing.

Rules:

- Check only after an explicit “Check for updates” click.
- No startup, login, focus, tray timer, daily timer, or background automatic checks.
- Checking never starts a download automatically.
- Show current/new version, channel, platform compatibility, and safely rendered release notes.
- Download is a separate user action with progress and truthful cancellation/failure behavior.
- Install/restart is another explicit action after verification.
- Reject wrong signature, unsupported architecture, malformed metadata, disallowed artifact host, incompatible channel, and non-newer version.
- Keep transport secure in production. Test-only fixtures must not enable insecure transport in shipping configuration.
- Bound repeated checks/downloads so double clicks cannot start parallel installations.
- Clean up only the updater’s validated temporary files, never user data.

No installed update can be described as verified solely because a manifest was parsed or a file was downloaded.

### 12.5 Safe install preparation

The current upstream Windows updater runs a synchronous before-exit hook, launches the installer, and exits the process directly. An asynchronous request_quit call in that hook cannot safely veto installation or guarantee Orbit’s cleanup finishes. [Updater implementation](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/updater/src/updater.rs).

Extract a shared, awaited, fallible preparation primitive:

1. Download and verify while Orbit remains usable.
2. Ask all relevant windows to save/discard pending drafts using section 6.
3. On refusal, invalid input, conflict, or missing acknowledgment, stop preparation.
4. Block new independent writes/navigation that could create more edits, while letting current transaction owners finish.
5. Pause reminder reconciliation/delivery and settle owned work with a deadline.
6. Create and verify a pre-update backup using the existing online-backup path.
7. Close the process-owned database after its consumers stop.
8. Flush logs and account for the updater’s direct-exit path in the clean-run marker.
9. Only then invoke installation.
10. Restart visibly as a user-requested update, without replaying stale background/capture/reminder arguments.

If preparation or installer extraction/launch fails, restore an operational app: reopen the correct database generation, restore readiness, restart the scheduler, clear quitting/preparing UI state, and retain/report the failure. Showing a window alone is not recovery.

A running timer retains the existing persisted session semantics; updating must not silently complete tasks.

If the installer starts successfully and subsequently fails outside the old process, use the documented installer/backup recovery path. Do not promise the already-exited process can recover itself.

### 12.6 Release pipeline and rollback

- Build app and matching updater artifact/signature together.
- Validate manifest version, channel, architecture, artifact URL, and signature against that exact build.
- Reject missing/mismatched outputs; never publish a pointer to incomplete assets.
- Keep the private-source and public-artifact permissions narrowly separated.
- Publication/promotion remains an explicitly authorized release operation.
- Keep the prior installer and pre-update backup guidance available.

An older binary may reject a newer database schema. “Rollback” therefore means a compatible binary plus an appropriate verified backup, not blindly running an old executable against current data. Restoring an older backup can lose later changes; require explicit confirmation and preserve the current database first.

### 12.7 PWA distinction

PWA updates stay with the existing service-worker mechanism; they do not use the Windows updater.

- Keep the user-controlled Reload action.
- Guard reload against unsaved drafts.
- Do not add periodic network polling.
- Document that normal browser/site/service-worker traffic while visiting the hosted app differs from desktop’s manual-only updater requests.
- Verify offline Notes and Review workflows after installation/caching.
- Do not claim the desktop has become cloud-dependent because the optional update button exists.

### 12.8 Updater acceptance

Use two disposable test builds with versions A and B and an isolated test feed/key. Do not tag/publish production solely to test.

Prove:

- No updater request on launch, focus, login startup, or ordinary use.
- Explicit check reports current/available/offline/error correctly.
- Invalid signature, missing artifact, malformed feed, timeout, wrong platform/channel, and downgrade are refused.
- Separate download/install consent works.
- Main/capture drafts and active transactions stop unsafe installation.
- A → B preserves data, login opt-in, tray, protocol ownership, and clean startup.
- Installer-launch failure leaves A usable with reminders restarted.
- The pre-update backup passes integrity checks.
- The approved real feed works for the intended audience without embedded credentials.

Optional-track statuses must distinguish: not selected, implemented with fixtures, deployment blocked pending owner decision, and fully verified. None of the first three means production updater complete.

## 13. Day-by-day execution schedule

### Day 1 — Baseline and architecture decisions

- Record existing gates and Week 11 VM gaps.
- Freeze review periods, steps, receipt schema, bill history, and contact semantics.
- Agree canonical URI/route and dirty-state contracts.
- Begin the installed Windows toast activation spike.
- Record optional updater hosting/key decisions as unresolved prerequisites, not assumptions.

Exit: expected behavior is written as tests/fixtures and the native risk is visible early.

### Day 2 — Schemas, stores, and compatibility

- Add WeeklyReview and WeeklyReviewAction schemas/stores.
- Add normalized bill occurrence fields.
- Append SQLite 3 / IndexedDB 4 / export 5 changes.
- Update source-version-aware backup validation.
- Add new fixtures and old-data migration/restore tests.

Exit: old data opens and new review/bill metadata survives round trips.

### Day 3 — Transaction-safe services and action receipts

- Extract current-record mutation helpers.
- Implement atomic review receipts/progress, idempotent capture conversion, and link deduplication.
- Define review revision conflicts and action result replay.
- Verify rollback across domain/progress/op-log writes.

Exit: repeating a user action cannot duplicate work, and failed actions do not advance the review.

### Day 4 — Draft/navigation infrastructure

- Migrate routing/test harness only as needed for supported blocking.
- Add draft coordinator and canonical destination resolver.
- Implement Save/Discard/Stay and pre-quit acknowledgment before database closure.
- Cover main/capture lifetimes and the PWA reload action.

Exit: a dirty editor cannot be silently lost through the new navigation/quit paths.

### Day 5 — People and commitments

- Build list/detail/forms and direction/status filters.
- Implement person-level contact/reply and separate completion.
- Reconcile reminder changes atomically.
- Add deleted-person recovery and exact commitment highlighting.

Exit: all People flows and source-validity tests pass.

### Day 6 — Bill recurrence and payment services

- Correct shared weekly recurrence ordering/duplicates.
- Add bounded next occurrence with original anchor/count.
- Implement payment, one successor, history, stopping, and legacy recovery.
- Test concurrent pay and rollback.

Exit: the same payment never creates two successors or changes historical schedule meaning.

### Day 7 — Bills UI and reminder integration

- Build groups, detail, paid history, recurrence summaries, and explicit stop/delete actions.
- Add due-soon boundaries and currency-aware totals.
- Verify native delivery rejects paid/deleted/stale sources.

Exit: user-visible bill actions match the tested service semantics.

### Day 8 — Notes editor and links

- Build list/detail, parent assignment, blur-save, conflict handling, and Save states.
- Add lazy safe Markdown preview.
- Improve LinkPicker loading/deduplication.
- Preserve old search previews and add real Open/Edit routes.

Exit: notes survive save/reload and malicious Markdown cannot execute or fetch content.

### Day 9 — Weekly review persistence and entry points

- Implement Start/Resume/Pause/history and Review again.
- Wire stable step IDs and real completed/deferred status.
- Enable the weekly command/Today entry point.
- Test reload and week-boundary behavior.

Exit: progress survives process restart without relabeling the review period.

### Day 10 — Inbox, overdue, and project steps

- Reuse completed mutation services.
- Add triage/conversion, explicit overdue choices, and project inspection/next action.
- Record receipts and changed-source acknowledgments.
- Keep timer and locked-block semantics intact.

Exit: the first three steps are usable and atomic end to end.

### Day 11 — Goals, bills, capacity, and completion

- Add goal/area controls and Bills reuse.
- Factor explicit-week capacity helper and keep booked versus targets separate.
- Add final recheck, summary, deferred counts, and read-only history.

Exit: a complete review can pause midway and finish with auditable decisions.

### Day 12 — Production notification routing

- Finish the chosen Windows backend and immediate-error contract.
- Wire protocol registration, initial/forwarded activations, readiness queue, and deduplication.
- Integrate the draft guard and actual task/person/bill/review routes.
- Add isolated native/parser tests.

Exit: installed clicks work while visible, hidden, booting, and exited.

### Day 13 — Browser and desktop regressions

- Run full tests, coverage, data-safety matrix, and existing budgets.
- Exercise two-window conflicts and import/restore with mounted drafts.
- Fix failures before updating any “complete” checkbox.

Exit: Week 8–11 behavior remains intact and Week 12 edge cases are covered.

### Day 14 — Installed Windows verification

- Complete relevant pending Week 11 VM scenarios.
- Verify protocol ownership, cold activation, reboot/autostart, sleep/resume, upgrade/uninstall.
- Record screenshots, build/OS versions, exact results, and any NOT RUN items.

Exit: installed routing is proved; an unavailable VM leaves this gate explicitly pending.

### Day 15 — Performance, accessibility, and handoff

- Profile new list/review loads and large-note rendering.
- Run keyboard/focus/high-contrast/narrow-window checks.
- Finish feature docs, migration notes, roadmap status, and release notes.
- Prepare buildable, reviewable commits with test evidence.

Exit: core Week 12 definition of done is satisfied.

### Optional Days 16–20 — Manual updater

Proceed only when selected and external prerequisites are available:

1. Confirm hosting/privacy/key ownership and approved channel endpoints.
2. Add signature/configuration/service/UI with fixture tests.
3. Extract fallible install preparation and complete failure recovery.
4. Extend release artifact validation and channel promotion workflow.
5. Verify A → B in the disposable environment and record real-feed status.

If hosting/keys are not approved, leave this track unconfigured. Finish the core milestone without falsely marking the DevOps updater deliverable complete.

## 14. Verification commands and evidence

Run implementation-time commands from C:\Orbit. These are planned gates, not tests already performed for Week 12.

### Focused test loops

Name the new suites so these filters select actual tests:

```powershell
pnpm exec vitest run --project core weeklyReview people bills recurrence reminders
pnpm exec vitest run --project storage weeklyReview migrations roundtrip
pnpm exec vitest run --project orbit weekly people bills notes deepLinks drafts
cargo test --manifest-path apps/orbit/src-tauri/Cargo.toml
```

Confirm nonzero relevant tests ran. Add a new suite to the correct Vitest project rather than treating an empty filter as success.

### Full regression gate

```powershell
pnpm lint
pnpm type-check
pnpm test:coverage
pnpm format:check
pnpm build
pnpm check:bundle
pnpm test:migrations
pnpm test:roundtrip
pnpm verify:backup
pnpm bench
pnpm e2e
cargo test --manifest-path apps/orbit/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/orbit/src-tauri/Cargo.toml --all-targets -- -D warnings
pnpm tauri:build:bin
pnpm e2e:desktop
```

Also run roundtrip with ROUNDTRIP_SIZE=50000 in a temporary process environment, restoring its prior value afterward.

Keep the existing coverage floors: core 90% lines/statements/functions, storage 85%, app 70% lines/statements and 65% functions.

Current prerelease installer gate:

```powershell
pnpm --filter orbit exec tauri build --bundles nsis
```

Use a separate updater-enabled test/release overlay when testing signatures. Do not require production keys for ordinary development or publish a tag merely to run a local check.

### Performance and responsiveness

- Preserve existing planner/search/insights/recurrence budgets.
- The Week 11 200ms insights budget measures the pure engine only. Repository loading and page rendering are not already benchmarked.
- Add repeatable measurements for weekly-review snapshot loading, first meaningful list render, receipt lookup, and note save/preview.
- Use the standard 50k-task dataset with representative people, bills, notes, and review histories.
- Proposed new targets on the recorded developer machine: pure review aggregation under 200ms mean, ordinary local save/receipt transaction under 200ms p95, and a warm list/review route’s usable first page within 1 second.
- Record dataset, build, hardware, samples, and p95; justify any target revision with measurements rather than silently raising a failing budget.
- Page/virtualize large lists and evidence. Do not mount thousands of editors or parse every note body to show a list.
- Do not rewrite all review receipts on each action or read all link candidates while the picker is closed.
- Benchmark the actual repository load separately from computation. A fast core function does not prove a fast page.

### End-to-end fixture

Seed only a disposable test dataset containing:

- Captures and inbox tasks, plus an already-processed capture for retry tests.
- Overdue tasks with and without locked blocks/running sessions.
- Active, stale, blocked, and no-next-action projects.
- Active goals and weekly area targets above/below capacity.
- A person with mixed-direction commitments and an older contact timestamp.
- One-off bills, January-31 monthly recurrence, limited COUNT, overdue recurrence, and legacy paid data.
- Notes with links, large bodies, invalid/hostile Markdown, and conflicting edits.
- Current and old paused reviews, and completed review history.
- Valid reminder rules/queued rows and missing/deleted targets.

Run a full weekly review, pause/restart, complete a payment, record contact, edit a note, click a notification, restore a backup, and re-open the completed summary. Verify state and operation history, not just screenshots.

Use date-based reminder fixtures or a test-only due-row injection. Do not modify the host clock or use the roadmap’s misleading “bill due in one minute” example for a 09:00 date-based rule.

### Report format

For every required gate, record PASS, FAIL, or NOT RUN with:

- commit/build and environment;
- command or exact manual steps;
- observed versus expected outcome;
- relevant artifact/screenshot/log location without personal content;
- known limitations and owner of remaining verification.

Do not replace a missing installed test with a statement that unit tests passed.

## 15. Planned files and reviewable checkpoints

### Core/storage

- packages/core/src/services/weeklyReview.ts
- packages/core/src/services/people.ts
- packages/core/src/services/bills.ts
- Existing recurrence, reminders, insight capacity, schema, and compatibility modules.
- packages/storage/src/weeklyReviews.ts and adapter-safe domain helper locations consistent with current conventions.
- WeeklyReview/WeeklyReviewAction store registration, migrations, exports, native backup verification, and new versioned fixtures.
- Focused core/storage tests for receipts, payment lineage, contact timing, and migration/restore.

### Frontend

- apps/orbit/src/features/reviews/WeeklyFlow.tsx and weekly service/history/step components.
- apps/orbit/src/features/people/*.
- apps/orbit/src/features/bills/*.
- apps/orbit/src/features/notes/*.
- apps/orbit/src/platform/deepLinks.ts and shared destination resolver.
- A shared draft coordinator/guard and task-route wrapper.
- Existing App/router/test harness, LinkPicker, search, insight routes, ResidentBridge, PWA reload, and Settings.
- Browser E2E for weekly review, people, bills, notes, and navigation conflicts.

### Native/optional release work

- apps/orbit/src-tauri/src/notifications.rs or equivalent Windows delivery abstraction.
- Native deep-link/activation module and resident integration.
- Existing scheduler, capabilities, NSIS configuration/hooks, and isolated desktop tests.
- Optional updater.rs and Settings Updates UI.
- Release configuration overlay, artifact validation, and .github/workflows/release.yml changes only when the optional track is selected.

### Documentation

- docs/WEEKLY-REVIEW.md.
- docs/PEOPLE-AND-COMMITMENTS.md.
- docs/BILLS.md.
- docs/NOTES.md.
- docs/DEEP-LINKS.md.
- Update docs/RESIDENT-BEHAVIOUR.md with actual installed evidence.
- Optional docs/UPDATES.md and docs/PRIVACY.md.
- Migration/fixture guidance, roadmap cross-references, and release notes.

Suggested commit checkpoints, each buildable with relevant tests:

1. feat(storage): persist weekly reviews and bill occurrence metadata.
2. refactor(app): make shared mutations and draft navigation safe.
3. feat(people): manage commitments and contact-based follow-ups.
4. feat(bills): preserve paid history and advance recurrence atomically.
5. feat(notes): add safe offline editing and record navigation.
6. feat(reviews): add resumable weekly review.
7. feat(desktop): route installed notification activations.
8. test(docs): verify and document week 12 workflows.
9. Optional feat(updates): add manually initiated verified updates.

Implementation commits, key generation, secret configuration, protocol registration, and publication are not performed by this planning task.

## 16. Definition of done

### Core Week 12

- [ ] People, Bills, Notes, and Weekly Review placeholders are replaced with working routes.
- [ ] All six review steps save real progress and choices.
- [ ] Restart/week rollover restores the correct review and frozen target dates.
- [ ] Repeated submissions cannot duplicate capture conversion, payment, successor, or review completion.
- [ ] Review receipts and domain changes commit or roll back together.
- [ ] Contact recording is distinct from completing commitments.
- [ ] Follow-up eligibility and timing agree in TypeScript and Rust.
- [ ] Recurring payment preserves history, original anchor/count, and one successor.
- [ ] Weekly recurrence ordering/duplicates and month-end cases pass.
- [ ] Note blur-save is durable, conflict-safe, and honestly labeled.
- [ ] Note preview cannot execute content or fetch embedded resources.
- [ ] Shared links/routes reach the correct record; task deep links open TaskEditor.
- [ ] Dirty navigation, true Quit, hidden capture, and PWA reload use the appropriate guard.
- [ ] Weekly booked capacity and area-target capacity are distinct and use frozen dates.
- [ ] Old databases/exports/backups migrate and restore correctly.
- [ ] Existing Week 8–11 regressions and performance budgets remain green.
- [ ] Keyboard/focus/loading/error/deleted-record states are covered.

### Installed desktop

- [ ] Toast submission reports immediate native failure honestly.
- [ ] Notification body clicks route correctly with Orbit visible, hidden, booting, and exited.
- [ ] Initial/current/forwarded activations stay in one instance and honor readiness/draft guards.
- [ ] URI payloads are validated and never execute domain mutations.
- [ ] Production protocol registration, NSIS upgrade, and uninstall ownership are verified.
- [ ] Relevant pending Week 11 installed scenarios are completed or clearly recorded as still pending.
- [ ] MSI remains unshipped until its separate stable-release cleanup/registration gate passes.

### Optional updater

- [ ] Owner selected hosting/privacy/channel/key management explicitly.
- [ ] No embedded private-repository credentials.
- [ ] Artifact signatures and approved HTTPS metadata/feed are verified.
- [ ] No automatic check/download/install occurs.
- [ ] All-window save preparation, backup, orderly handoff, and failure recovery pass.
- [ ] A → B is verified on a disposable installed build.
- [ ] Deployment status is separate from fixture-only implementation status.
- [ ] Recovery guidance does not promise unsafe schema downgrade.

### Handoff

- [ ] Each required automated/manual gate has actual evidence.
- [ ] Roadmap checkboxes distinguish implemented, verified, pending, and optional.
- [ ] Existing untracked/user changes remain untouched.
- [ ] Feature docs state limits and exact semantics.
- [ ] No Week 13 release, encryption, cloud service, or background update scope was silently added.

## 17. Final recommendation

Build the domain operations and safe-save foundation first, then assemble the weekly review from those tested pieces. Prove Windows cold notification activation early.

Treat the optional updater as a separate delivery track: it has real hosting, signing, and shutdown prerequisites. Finish the local workflows even if that deployment decision remains open, and report the updater honestly as unconfigured/pending rather than implying the entire roadmap is complete.
