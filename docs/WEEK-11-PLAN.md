# Orbit — Week 11 Detailed Implementation Plan

## 1. Outcome and baseline

Make Orbit explain what needs attention, show the records behind each observation, and remain available on Windows after the main window is closed.

This is an implementation plan, not a completion report. All acceptance checks below are still to be performed during implementation.

- Prepared: 14 September 2026.
- Repository baseline: 72d4291 — feat: week 10 — search, command palette, undo, local diagnostics.
- Builds on Week 10 search, previews, commands, undo, local diagnostics, and the earlier transaction/reminder/restore fixes.
- Roadmap inputs: docs/BACKEND-TASKS.md, docs/FRONTEND-TASKS.md, docs/DEVOPS-TASKS.md, and docs/WEEK-10-PLAN.md.
- Preserve existing work, including the currently untracked Week 10 plan. Do not mix unrelated changes into Week 11.
- Recommended budget: 10–12 focused working days for one developer, plus up to 2 contingency days for installed-Windows verification. “Week 11” is a milestone name, not a promise that all three tracks fit into five days.

### The finished experience

1. Insights tells the user which projects are stale, where recorded work exceeds estimates, which days are overloaded, whether weekly area targets exceed available time, and which people have several open commitments.
2. Each observation explains its calculation, threshold, applicable date range, and actual source records.
3. Today shows at most three relevant, unsuppressed insights. Projects, goals, and Timeline use consistent underlying health calculations.
4. Snoozing, dismissing, reopening, importing, and restarting behave predictably.
5. Windows has one Orbit process, one tray icon, reliable manual launch, opt-in login startup, and an explicit Quit action.
6. Reminders continue while the main window is hidden. After sleep or shutdown they catch up when Orbit can run again; Orbit does not promise notifications while the computer is asleep or the process is not running.

## 2. Scope and ownership

| Track     | Week 11 deliverables                                                                                                                    | Explicit boundary                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Core      | Pure insights engine; five detectors; shared health and full-day capacity; threshold validation; deterministic evidence and suppression | No AI service, prediction model, automatic replanning, or automatic estimate edits     |
| Storage   | Insight-state persistence; compatible settings normalization; export/import and restore coverage                                        | No unnecessary SQL/IndexedDB structural migration                                      |
| Frontend  | Insights page and history; Today strip; shared health badges; Timeline overload evidence; settings                                      | No full People, Bills, Notes, or Weekly Review product screens                         |
| Desktop   | Single instance; lifecycle coordinator; tray; close-to-tray; opt-in autostart; resident reminder readiness                              | No Windows service, system-wide startup, or headless Rust rewrite of the whole app     |
| Packaging | Installed Orbit notification identity; NSIS upgrade/uninstall behavior; clean-VM evidence                                               | No release publication, updater, signing rollout, or version bump merely for this plan |

### Resolve the Week 11 / Week 12 overlap

The DevOps roadmap assigns tray, autostart, notification identity, and close behavior to Week 11. Backend/frontend repeat some tray infrastructure under Week 12.

Use this boundary:

- Week 11 owns the resident process and tray actions: Open Orbit, Quick Capture, Plan my day, and Quit.
- Plan my day opens the existing Today planning flow. It does not silently accept or replace a plan.
- Week 12 owns richer reminder-click routing into People, Bills, and Weekly Review, alongside those completed screens.
- Week 11 verifies notification delivery and installed identity; a rich entity-specific click action is not a Week 11 completion requirement.
- Update the roadmap cross-references during implementation. Do not mark all of Week 12 complete because tray infrastructure shipped early.
- Keep the existing unsigned, trusted-circle distribution decision. Signing and updater work are separate decisions.

### Do not add these to fill perceived gaps

Task tags/types, per-goal hour requirements, working-weekday preferences, cloud analytics, notification action buttons, a recommendation-learning system, and automatic remediation are not required for this milestone. The calculations below use fields Orbit actually has.

## 3. Recommended fix and build order

Build the foundations before the surfaces. Start the desktop lifecycle work early enough to expose Windows problems before the final day.

| Order | Work package                                                       | Completion gate                                                         |
| ----- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 1     | Record baseline and freeze calculation/lifecycle decisions         | Existing failures classified; test fixtures and contracts agreed        |
| 2     | Normalize settings and extend insight state                        | Old records load; adapters and export/import preserve new fields        |
| 3     | Implement indexed snapshot, shared health, and five pure detectors | Boundary tests pass with explainable, deterministic output              |
| 4     | Implement suppression service, caching, and refresh                | Persistent state and cross-window/time changes work without write loops |
| 5     | Build Insights page and integrate existing surfaces                | Evidence opens the right record/date; Today and badges agree            |
| 6     | Establish native startup, single instance, tray, and shutdown      | One reachable process; hide is not teardown; Quit is real               |
| 7     | Make reminder preparation reliable in resident mode                | Cold autostart and hidden overnight scenarios work                      |
| 8     | Wire native preferences and autostart                              | Explicit opt-in; actual OS registration read-back; safe migration       |
| 9     | Verify installed identity and installer cleanup                    | NSIS install/upgrade/reboot/uninstall evidence recorded                 |
| 10    | Run full regressions, performance, accessibility, and handoff      | Every required gate has evidence or is explicitly pending               |

With two developers, packages 2–5 and the foundations of package 6 can run in parallel after package 1. They converge on shared settings, repository readiness, and cross-window event contracts. Do not implement competing versions of those contracts.

## 4. Preflight: establish a trustworthy starting point

### 4.1 Inspect before changing

- Read repository guidance and current roadmap status.
- Record branch, HEAD, and git status.
- Check the installed Node, pnpm, Rust, Tauri CLI, WebView2, and matching WebDriver versions. Use the checked-in lockfiles; do not upgrade unrelated dependencies.
- Run the existing baseline gates listed in section 14.
- Separate pre-existing failures from Week 11 regressions. Fix a blocking data-safety regression before adding dependent features.
- Preserve shipped migration files and versioned fixtures unchanged.
- Capture representative screenshots of Today, Timeline, Projects, Goals, and Settings to compare existing behavior.

### 4.2 Reuse these implementation points

| Existing code                                       | What to reuse or correct                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| packages/core/src/services/completion.ts            | Per-area ratio-of-sums estimate accuracy; retain sample evidence and tighten validity boundaries |
| packages/core/src/services/projectHealth.ts         | Project health semantics; share the configurable stale threshold                                 |
| packages/core/src/services/goalAttention.ts         | Existing neglected-goal and area-attention signals                                               |
| packages/core/src/services/atRisk.ts                | Keep at-risk interpretation consistent with shared health                                        |
| packages/core/src/planner/capacity.ts               | Interval/date helpers, but not remaining freeMin as an overload denominator                      |
| packages/core/src/rules/constraints.ts              | Ordered reservation and energy constraints                                                       |
| packages/core/src/schema/entities.ts                | Existing AppSettings and InsightState records                                                    |
| apps/orbit/src/features/today/todayService.ts       | Replace computeInsightsStub and the competing local Insight type                                 |
| apps/orbit/src/components/HealthBadge.tsx           | Extend existing badges instead of building a second health vocabulary                            |
| apps/orbit/src/features/search/SearchPreview.tsx    | Real task/person preview destinations while Week 12 screens remain incomplete                    |
| apps/orbit/src/features/timeline/TimelinePage.tsx   | Add URL date/block selection; current local date state does not fulfill evidence links           |
| apps/orbit/src/features/settings/settingsService.ts | Normalize old records and merge fresh settings transactionally                                   |
| apps/orbit/src-tauri/src/lib.rs                     | Plugin order, window events, startup, and clean-exit integration                                 |
| apps/orbit/src-tauri/src/scheduler.rs               | Native delivery, source validation, transaction ownership, and terminal-history deduplication    |

The present “insights” benchmark measures health/attention helpers, not a full insights engine. Replace that benchmark workload before claiming Week 11 performance.

## 5. Core insights contract

### 5.1 Pure input and output

Create packages/core/src/insights with one public computeInsights entry point.

Input:

- A coherent, read-only snapshot of areas, goals, projects, milestones, tasks, sessions, events, routines/instances, blocks, day commitments, people, person commitments, and relevant rules.
- Normalized planning and insight settings.
- An injected clock and explicit local-date context.
- No React hooks, database connections, filesystem, browser globals, or network calls.

Output per insight:

- Stable key and kind.
- Severity: info, attention, or risk.
- Plain-language title and detail.
- Typed subject reference.
- Typed evidence rows with entity references, measured values, units, and relevant dates.
- Threshold with actual value, comparison operator, configured limit, and sample size where applicable.
- computedAt from the injected clock.
- A source fingerprint for “until data changes” behavior.
- An algorithm version for controlled future compatibility.

Keep numerical values separate from formatted strings. For example, retain 1.4 as a ratio and format it as 1.40× in the UI. Do not infer calculations by parsing card copy.

Return detector coverage metadata alongside the insight list: applicable subject, eligible/required sample counts, whether computation was available, and a typed unavailable reason. An empty insight list alone cannot distinguish insufficient evidence from a healthy calculation. The UI must use this metadata rather than reimplementing detector filters.

### 5.2 Determinism and stable identity

Example keys:

- estimate-bias:area:<area-id>, or estimate-bias:unassigned.
- stale-project:<project-id>.
- overloaded-day:<YYYY-MM-DD>.
- weekly-target-deficit:<week-start-date>.
- person-commitments:<person-id>.

Titles, computedAt, current sort position, and changing numerical severity must never form part of a key.

Sort by severity first, then a documented detector priority, then date/subject/key as a total tie-breaker. Use risk before attention before info. Within a severity, use overload, weekly deficit, stale project, estimate bias, then person commitments.

Requirements:

- Every emitted insight has non-empty evidence.
- Identical input and clock produce identical output.
- Reordering input arrays does not change keys, ordering, fingerprints, or numerical results.
- Deleted/missing references do not crash the engine or expose raw invalid URLs.
- Reading insights never writes records or appends operations.
- Build indexes once. Do not filter all 50,000 tasks separately for every project, goal, and card.

### 5.3 Evidence presentation contract

Evidence is the proof behind the observation, not another warning sentence.

Support rows for:

- Entity metrics: task estimate and recorded actual; person commitment direction/status.
- Activity: project, task, milestone, or session responsible for last activity.
- Day demand: exact block IDs and accepted-but-unscheduled task IDs.
- Capacity: working window, rest/event/reservation exclusions, remaining total.
- Weekly targets: each counted area target and each date’s capacity.

Keep the full auditable contributing set available. Render large sets in pages or a virtualized list, showing the total count; do not silently truncate evidence to the first five records.

No raw HTML in titles or evidence. Use existing safe rendering and local navigation helpers.

## 6. Exact detector specifications

### 6.1 Estimate bias — attention

User-facing example: “Work recorded in University took 1.40× the estimated time across 8 completed tasks.”

Default settings:

- Completion window: previous 30 elapsed days, including now.
- Minimum valid samples: 5.
- Trigger: sum(actual minutes) / sum(estimated minutes) > 1.3.

Rules:

1. Group by effective area using the existing task-to-project area resolution. There is no tag/type field to group by in Week 11.
2. Consider live completed tasks with a valid completedAt in the inclusive interval [now − windowDays, now].
3. Exclude zero estimates, absent completion times, invalid/future completion times, and missing recorded actuals.
4. Explicit actualMin wins over sessions, including an explicitly recorded zero.
5. Otherwise sum valid, live, closed sessions for that task. Exclude running sessions and invalid/future intervals from this historical estimate measure.
6. Sum the actual and estimated minutes first, then divide. Do not average per-task ratios.
7. Use an “Unassigned” group when no live area resolves. Do not quietly attribute work to an unrelated area.
8. Show the exact window, sample count, totals, task estimates/actuals, and actual source.
9. Wording describes recorded time, not certainty about productivity or a statistically proven population bias.
10. Do not change any task estimate automatically.

Required cases: 4 versus 5 samples; exactly 1.3 versus just above; explicit zero; explicit actual versus sessions; missing actual; zero estimate; future/out-of-window completion; unassigned area; deleted records; input-order stability.

### 6.2 Stale projects — attention

User-facing example: “Website redesign has had no recorded activity for 12 days.”

Default trigger: at least 10 complete elapsed 24-hour periods since last relevant activity.

Rules:

1. Only live, active projects can produce this insight.
2. Use one shared last-activity calculation for Insights, Today, project lists/details, and at-risk views.
3. Activity includes the project record, related task/milestone changes, and valid task-session start/end activity.
4. A related task or milestone soft-deletion counts as activity when its relationship is still available in the tombstone. Use tombstones for activity only, never for progress or open-work counts.
5. Insight snoozes/dismissals, unrelated operations, and merely reading a project are not activity.
6. Do not scan the entire operation log on every render. Derive an activity map once from available records; add narrowly scoped support only if a required deletion relationship is otherwise lost.
7. Clamp future/invalid timestamps defensively; do not produce negative stale days.
8. Evidence names the last relevant activity, timestamp, elapsed days, and configured threshold.
9. A project with no child work still uses its own creation/update history.

This deliberately reconciles the roadmap’s narrower “project/task operation” wording with the existing richer health helper. Update all consumers together so the badge and the insight cannot disagree.

Required cases: just before/exactly 10 days; changed threshold; project/task/milestone/session activity; deletion activity; completed/archived/deleted project; no children; snooze does not reset the activity clock.

### 6.3 Overloaded days — risk

User-facing example: “Wednesday has 555 minutes of committed work and 495 minutes of available work time.”

Default trigger: committed work minutes > full-day work capacity × 1.1.

Evaluate today and the following six local dates.

#### Capacity definition

Calculate the whole date, not the time remaining after now:

1. Start with the saved working window.
2. Apply enabled constraint rules in their existing deterministic order.
3. Subtract the union of clipped rest boundaries, calendar events, and no-area reserved/busy intervals.
4. Area-specific reservations remain usable work time; retain their labels in evidence.
5. Energy restrictions constrain allocation but do not remove all work capacity.
6. Do not subtract task/routine/manual work blocks here; they are demand below.
7. Do not subtract elapsed time today.
8. Use interval minutes; overlapping exclusions count once.

Do not pass buildCapacity().freeMin directly into this comparison. That value also subtracts fixed blocks and elapsed time, which would double-charge work and create misleading afternoon warnings.

#### Demand definition

- Count each live task/routine work block on the date by its stored duration.
- Count live unreferenced manual blocks as work.
- Exclude event-reference blocks because their event already reduces capacity.
- Exclude blocks whose task is deleted/archived, or whose routine instance is deleted/skipped or has no valid parent.
- Retain valid completed-task and done-routine blocks: this is a full-day booked-work measure, not a remaining-work measure.
- For each accepted live unfinished task with no counted block on that date, add its estimate once, rounded using the existing planner minimum/grid rules. A zero estimate uses the saved default estimate.
- Deduplicate accepted IDs across records for the same date.
- Do not add an entire task estimate on top of its stored blocks. Split parts count by their own durations.
- A commitment whose blocks were removed remains accepted-unscheduled until the commitment is changed. Make that visible in evidence.
- Unaccepted proposal blocks are not stored commitments and do not count.
- Sum overlapping work blocks rather than unioning them: they represent competing commitments.
- Count out-of-working-window booked work in demand. Show its times so the user can see why their chosen working window is exceeded.

#### Buffer and feasibility policy

For this first detector, “committed work minutes” excludes transition buffers. The planner continues reserving its normal buffer while placing work; Week 11 must not change that algorithm.

Explain in the evidence footer: “Workload comparison only. Buffers, fragmented gaps, area reservations, and energy restrictions can make a plan infeasible even below this threshold.”

This is an explicit diagnostic definition, not a claim that an apparently under-capacity plan will fit. Do not invent mandatory end-of-day buffers that the current planner does not require. A later scheduling-feasibility insight can model those constraints separately.

#### Edge cases and examples

- Capacity 495m, demand 544.5m: no warning at exactly 110%.
- Capacity 495m, demand 555m: warning.
- Capacity 0m and demand 0m: no warning.
- Capacity 0m and demand 120m: warning saying “no available work time”; never display Infinity or NaN.
- Advancing the clock from morning to afternoon with unchanged records does not alter this date’s full-day capacity.
- Existing Timeline collision validation remains independent; this detector must not replace it.

Evidence must reconcile to the displayed totals and link to the exact date and contributing blocks/tasks.

### 6.4 Weekly area-target deficit — risk

User-facing title: “Weekly area targets exceed available time.”

This implements the roadmap’s goal-time-deficit requirement using the actual schema: areas have weeklyHoursTarget; goals do not have independent required-hours fields.

Period: the next full Monday–Sunday week, strictly after the current week. Display its exact dates.

Calculation:

- Required minutes = 60 × sum of positive weeklyHoursTarget values for live areas, counted once per area.
- Available minutes = sum of the full-day capacities from section 6.3 across those seven dates.
- Deficit = required − available.
- Trigger only when deficit > 0.

Rules:

1. Do not multiply an area target by its number of active goals.
2. Do not manufacture a per-goal target or imply each goal is individually impossible.
3. Include a live area target even if the area has no active goals; it is still the user’s area-level commitment.
4. Current working-window settings apply daily. There is no working-weekday preference, so weekends count unless existing reservations block them. Say this in the explanation.
5. Count an area-reserved interval once, not once globally and again for its area.
6. Do not subtract scheduled area work a second time: it may already fulfill the targets being compared.
7. As with day load, this is aggregate capacity, not a proof of feasible area/energy allocation or a buffer-aware schedule.
8. Zero total targets produce no warning.
9. Evidence includes every counted area target, seven daily capacity breakdowns, and the arithmetic.

Keep existing per-goal neglect signals for goal badges; do not label an individual goal “over capacity” solely because the global area total is high.

Required cases: one area with several goals; no active goals; zero targets; exact equality; changed working window; overlapping events/rest; enabled/disabled reservations; seven-day rollover; weekends; no-area versus area reservations.

### 6.5 Many open commitments with one person — info

User-facing example: “There are 4 open commitments with Sara: 3 you owe and 1 owed to you.”

Default trigger: at least 3 live open commitments for one live person.

- Include both directions, but show their subtotals explicitly.
- Exclude done, dropped, and soft-deleted commitments and deleted people.
- Evidence lists each commitment’s text, direction, due date if any, and person reference.
- Use the existing person preview for drill-down rather than the unfinished People page.
- Do not suggest that “owed to me” items are obligations the user personally owes.

Required cases: 2 versus 3; mixed directions; closed/deleted commitments; deleted/missing person; deterministic evidence ordering.

### 6.6 Preserve existing signals without inventing a sixth detector

Project blocked/no-next-action/overdue indicators and neglected-goal presentation remain available through the existing shared health helpers.

The Week 10 “Show neglected goals” command currently changes destination when insights capability is enabled. In the same integration change:

- Keep that command pointed at the working /goals?filter=neglected experience.
- Add an explicit “Open insights” command for /insights.
- Update command tests before enabling the new capability.
- Do not leave /insights?focus=neglected-goals as a route with no defined content.

## 7. Settings, persistent state, and compatibility

### 7.1 Insight settings

Add a validated insight-settings group to AppSettings.

| Setting                     | Default | Accepted bounds |
| --------------------------- | ------- | --------------- |
| Stale project days          | 10      | Integer 1–90    |
| Estimate observation window | 30 days | Integer 7–180   |
| Estimate minimum samples    | 5       | Integer 5–100   |
| Estimate ratio threshold    | 1.3     | Finite 1.05–3   |
| Day overload ratio          | 1.1     | Finite 1–2      |
| Person commitment count     | 3       | Integer 1–20    |

Allow defaults to be restored without resetting planning preferences. Validate on input and at the storage boundary. Invalid newly entered settings must fail visibly, not silently fall back.

Compatibility handling is different: missing fields in valid old records receive documented defaults. Malformed present values must be reported or repaired through an explicit, tested compatibility policy.

### 7.2 State model and exact suppression behavior

Reuse InsightState. Retain its existing insightKey, snoozedUntil, dismissedAt, and base-record fields.

Add:

- snoozeMode: time, change, or null.
- suppressedFingerprint: string or null.
- A small versioned lastSummary snapshot for history: kind, title, subject references, and essential metrics. Do not duplicate every evidence row or note body.

Use these semantics:

| Action             | Behavior                                                                            |
| ------------------ | ----------------------------------------------------------------------------------- |
| Snooze 1 day       | Suppress for exactly 24 elapsed hours from the action                               |
| Snooze 1 week      | Suppress for exactly 7 × 24 elapsed hours                                           |
| Until data changes | Suppress until relevant source records or relevant threshold/settings values change |
| Dismiss            | Suppress this stable key until the user explicitly restores it                      |
| Restore / unsnooze | Clear suppression; immediately recompute against current data                       |

Timed snooze remains in force despite source edits until its deadline. At exact expiry, it no longer suppresses. A dismissed insight does not silently return because its numbers changed; use “until data changes” for that behavior.

A dated insight has a dated key: dismissing this Wednesday’s overload does not dismiss every future Wednesday.

### 7.3 Fingerprint rules

- Hash canonical, sorted semantic source values, subject relationships, and only relevant settings.
- Include deletions, completion/status changes, and source additions/removals when they affect the subject.
- Exclude computedAt, current stale-day counters, formatted copy, unrelated operation-log entries, and the insight’s own suppression state.
- Time alone must not wake an until-change snooze.
- For rolling estimate windows, compute the source revision from the relevant area’s recorded source data independently of which samples age out today; sample aging alone is not a source edit.
- A new weekly/date key represents a new observation, not an expired suppression for the old key.
- Keep fingerprint computation bounded and indexed; do not serialize the entire repository for every insight.
- Include algorithm version so a deliberate change in meaning can invalidate an until-change fingerprint. Permanent dismissal remains controlled by its stable key.

### 7.4 Transaction and duplicate rules

- State IDs remain valid UUIDs; insight strings are lookup keys, not record IDs.
- Upsert by insightKey within one owned repository transaction.
- If legacy/imported duplicates exist, choose a canonical row by updatedAt and ID, merge the chosen effective state, and retire duplicates within that transaction.
- Re-read current state in the transaction to prevent concurrent snooze/dismiss actions from overwriting an unrelated newer change.
- Define last-committed user action as the winner for simultaneous actions on the same key.
- Publish data-change notifications only after commit.
- Never call the root repository from inside an owned transaction callback.
- Reading a page, reaching snooze expiry, or resolving an insight must not write back computed state.
- Provide explicit Restore actions; do not silently enroll suppression operations into generic Week 10 undo unless a safe undo contract is added and tested.

### 7.5 Old records and exports

Zod defaults alone are insufficient: existing SQLite rows are returned as JSON casts, and settings loading currently returns existing records without schema parsing.

Required work:

1. Add shared normalization for old AppSettings and InsightState records at actual hydration/read boundaries for memory, IndexedDB, and SQLite.
2. Apply the same policy to import, backup restore, and repository replacement.
3. Map a legacy non-null snoozedUntil to time mode.
4. Preserve a legacy dismissedAt as a permanent dismissal.
5. Show a safe “previously dismissed observation” fallback for old history without a summary.
6. Save settings by merging a fresh record inside a transaction, including nested groups. A stale Settings form must not overwrite working windows or another window’s insight preferences.
7. Refresh mounted Settings controls after import/restore.
8. Use export schema version 4 for the new persistent contract, with defaulted reads for versions 1–3 and rejection by older readers rather than silently stripping new fields.
9. Keep SQLite schema version 2 and IndexedDB version 3 if the implementation adds only JSON fields and no indexes/tables. Do not bump physical schema versions just to make fixture filenames change.
10. Preserve existing versioned fixtures byte-for-byte. Adjust the fixture generator to create only the requested new export version, and use separately named behavior fixtures for new JSON fields on unchanged database structures.
11. Verify export→import→export and real SQLite backup→restore with timed snooze, until-change snooze, dismiss history, and custom thresholds.

Native close-to-tray and autostart preferences are machine-local and must not be added to domain exports.

## 8. App data flow and refresh

Create one feature-level insight snapshot service and one shared hook/provider.

Data flow:

1. Read a coherent repository snapshot and normalized preferences.
2. Build reusable membership, activity, session-total, and date indexes.
3. Compute raw insights and shared health maps once.
4. Read and apply suppression state.
5. Sort deterministically.
6. Select a surface’s view; Today takes the first three only after suppression.
7. Resolve evidence references to app routes in the app layer, not in core.

Refresh on:

- Relevant committed data changes.
- Settings changes.
- Snooze expiry and the next stale-threshold boundary.
- Rolling estimate sample expiry: schedule the first instant after completedAt + windowDays because the window is inclusive. Recompute the measure without waking an until-change snooze merely because time passed.
- Local midnight/week rollover.
- Window focus and system resume.
- Another window’s relevant committed changes.
- Import, restore, data-directory relocation, and repository-generation replacement.

Implementation constraints:

- Reuse local dataVersion where appropriate, but it does not cover time or other windows by itself.
- Add a scoped cross-window commit signal or operation-log-head check consistent with Week 10 refresh behavior.
- Use one scheduled next-boundary timer rather than one timer per card.
- Cancel obsolete reads and prevent old repository-generation results replacing fresh data.
- Dispose listeners/timers when the owning provider actually unmounts.
- Do not recompute the 50k snapshot per keystroke, render, or one-second timer.
- Keep a loading/error state distinguishable from a genuinely empty result.
- On a refresh failure, identify previously displayed data as stale and offer retry; do not present “All clear.”

## 9. Frontend work packages

### 9.1 Insights page

Add a real /insights route, navigation entry, and command.

Page structure:

- Title, brief description, and computed/refresh status.
- Active insights grouped by risk, attention, then info.
- Expandable evidence per card.
- Threshold and sample size visible without expanding.
- Snooze menu: 1 day, 1 week, until data changes.
- Dismiss action with feedback and a clear route to restore.
- History view with dismissed and currently snoozed items, timestamps, state, and Restore.
- Empty states for no active observations, only suppressed observations, no history, and insufficient data.

Do not claim “Everything is healthy” merely because the user has dismissed all warnings or has fewer than five estimate samples.

### 9.2 Card and evidence components

- Make the entire interaction keyboard-accessible, with named controls and visible focus.
- Use text/icon labels as well as severity color.
- Collapse large evidence lists by default; expansion must not change the calculation.
- Show minutes/hours and dates consistently with existing formatting.
- Re-fetch a referenced entity before destructive actions; evidence itself remains read-only.
- For an entity deleted after computation, show a useful unavailable message and refresh option rather than a blank screen.
- Focus returns to the originating control when a menu, preview, or evidence panel closes.
- After dismiss/snooze removes a card, move focus to the next sensible item or group heading and announce the change.

### 9.3 Today strip

- Remove computeInsightsStub as a source of live insights.
- Use the same suppressed, sorted result as /insights.
- Show no more than three cards and a “See all” link.
- Keep existing planning, overdue work, blocked-project, and goal-attention sections functional; replacing the stub must not remove their established workflows.
- Ensure reload and another window’s snooze produce the same top three.

### 9.4 Project and goal health

- Extend the existing HealthBadge component.
- Thread stale settings through project health, structure services, Today, and at-risk calculations.
- Reuse existing goal-attention semantics and labels.
- Do not erase factual health badges when an insight is dismissed; suppression controls notifications/cards, not whether the project is objectively stale.
- Avoid duplicate helper scans for each row of a long list.

### 9.5 Timeline overload and evidence links

- Add validated date query parsing and exact block focus/highlight.
- Use a canonical route such as /timeline?date=YYYY-MM-DD&block=<uuid>.
- A valid date selects that date even outside today/tomorrow presets.
- Malformed dates/IDs fall back safely without infinite navigation or state-sync loops.
- Highlight and scroll the referenced block once the selected day loads.
- If a block was removed, retain the selected date and explain that the block is no longer available.
- Header warning and evidence page use the same day-load result.
- For an arbitrary selected date outside today plus six dates, call the shared dayLoad helper directly for that date. Keep the global Insights list limited to its seven-date horizon; do not emit every historical/future date globally.
- Evidence for working windows/rest/settings can open the relevant Settings section; rule and event evidence must use a working existing destination or an inline read-only preview.

### 9.6 Settings and platform differences

- Add an Insights section with validated thresholds, help text, and Restore defaults.
- Put resident controls in a separate Desktop section.
- Web/PWA must not claim native tray, autostart, or hidden native reminder support.
- Native settings show current operational status, not only a saved desired boolean.
- Explain that Windows notification settings or Do Not Disturb can suppress visible toasts.

## 10. Desktop resident architecture

### 10.1 One coordinator owns lifecycle

Add a native resident/lifecycle coordinator that owns:

- Launch reason: explicit user launch, login autostart, or allowed capture command.
- Initialization state: booting, ready, degraded/error, quitting.
- Main-window visibility policy.
- Tray availability and close behavior.
- Scheduler shutdown.
- Queued navigation requests until the app is ready.

Keep the main webview loaded when hidden. Today, Rust begins with an unopened database, and frontend initialization opens/migrates it and prepares reminders. A hidden window is not equivalent to a fully initialized headless app.

### 10.2 Required behavior matrix

| Event                                      | Required result                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| Manual cold launch                         | Main shows; initialization succeeds; one tray and one scheduler                     |
| Manual launch after prior hidden state     | Main is shown/unminimized/focused, not restored invisibly                           |
| Opted-in login launch                      | Main initializes hidden without flashing, then reports resident readiness           |
| First run or actionable startup failure    | Main becomes visible with onboarding/recovery/error                                 |
| X with close-to-tray on and tray available | Main hides; providers, database, capture, and reminders remain alive                |
| X with close-to-tray off                   | Explicit process shutdown, including any hidden capture window                      |
| Tray creation failure                      | Main stays reachable; disable close-to-tray for that run and explain                |
| Tray Open                                  | Show/unminimize/focus the existing main window                                      |
| Tray Quick Capture / capture hotkey        | Open the existing capture flow; closing it hides that capture window                |
| Tray Plan my day                           | Show main and open the current Today planning flow, without accepting a plan        |
| Tray Quit                                  | Real shutdown regardless of close preference                                        |
| Second manual process                      | Activate existing instance; no second database, scheduler, or crash marker          |
| Duplicate login launch                     | Keep the existing instance running without stealing focus                           |
| Restore/relocate                           | Pause generation-sensitive background work; reinitialize and reconcile before ready |

Close-to-tray decisions apply only after native preferences and legacy migration have settled. If the user presses X during unresolved initialization, keep main reachable and explain that startup is still completing; never hide under a temporary default before reading an explicit legacy off preference.

### 10.3 Plugin and startup sequence

1. Add the Tauri v2 single-instance plugin first, before logging::begin_run, shortcut registration, database ownership, and scheduler startup.
2. Allowlist internal launch actions. Do not accept arbitrary external URLs or shell commands as second-instance navigation.
3. Create/configure main initially hidden, then apply the explicit launch policy.
4. Exclude saved visibility from window-state restoration. Ensure saved minimized state cannot defeat explicit manual activation either.
5. Initialize native preferences and tray.
6. Mount the normal frontend database/settings initialization.
7. Receive a readiness handshake only from the designated main initializer after database migration, native preference migration, and initial reminder reconciliation. Include the current database generation; ignore stale-generation or capture-window acknowledgments.
8. On timeout/failure, surface the main window and actionable error rather than leaving an unreachable hidden process.

Tauri documents first registration for single-instance handling and provides the tray APIs through its Rust tray-icon feature. Match the implementation to the repository’s actual v2 dependencies, rather than copying v1 examples. [Single-instance documentation](https://v2.tauri.app/plugin/single-instance/), [system tray documentation](https://v2.tauri.app/learn/system-tray/).

### 10.4 Tray assets and commands

- Use the existing Orbit identity and code/vector-native icon assets where possible.
- Supply legible light/dark taskbar variants and verify high-DPI appearance.
- Menu: Open Orbit, Quick Capture, Plan my day, separator, Quit.
- Define left-click behavior explicitly: activate main. Right-click opens the menu.
- Repeated menu actions must not create extra windows or register more shortcuts/schedulers.
- Do not label the menu as ready before its commands can be fulfilled; queue navigation during boot.

### 10.5 Safe shutdown and database ownership

Current PlatformProvider cleanup closes the repository, which can close the shared native database. Hiding must not unmount that provider.

Implement a shutdown sequence:

1. Enter quitting state and reject new independent interactive writes with clear feedback. Continue accepting operations, commit, and rollback for transactions already owned before shutdown began.
2. Stop scheduling new reminder ticks/reconciliations.
3. Signal the scheduler thread to stop using an interruptible wait, then join with a bounded deadline. Do not wait for an uninterruptible full polling sleep.
4. Let existing owned transactions settle, or safely roll them back through the existing ownership mechanism.
5. Close the process-owned database only after its consumers have stopped.
6. Flush local logs and persist window/native preferences.
7. Mark the run clean only after successful orderly shutdown.
8. Exit all windows and the process.

Use a bounded interactive shutdown wait. If a write cannot settle safely, keep the app visible with an error/retry path rather than silently exiting midway. OS session termination needs its own bounded best-effort handling; never falsely mark an incomplete shutdown clean.

Do not change timer-domain semantics incidentally: preserve existing persisted running-session behavior across exit/relaunch rather than silently completing tasks or sessions.

## 11. Reliable reminders while resident

This is a prerequisite for the tray feature, not a final polish item.

### 11.1 Fix preparation, not only delivery

The Rust loop delivers persisted due notifications. The TypeScript reminder computation currently omits some bill/follow-up rows until their threshold date arrives. A hidden JavaScript timer is not sufficient evidence that tomorrow’s rows will exist.

Recommended bounded solution:

- Materialize future reminders for currently known valid bill/follow-up sources.
- Store their actual future fireAt; the native scheduler remains responsible for when to deliver.
- Do not expand an unbounded recurrence series. Prepare only reminders supported by the currently stored source occurrence and existing stable-key policy.
- Use wording that remains correct after waiting: explicit due dates and contact dates, not “due in 3 days” frozen at queue-generation time.
- Reconcile on startup, relevant source/rule changes, resume, local date/timezone changes, and repository replacement.
- A lightweight native wake/acknowledgment can request reconciliation when needed, but overdue known rows must not depend solely on an unthrottled hidden JS interval.
- Propagate relevant writes from capture/other windows after commit so the loaded main webview can reconcile.
- Do not trigger reconciliation recursively from its own notification/op-log writes.

### 11.2 Readiness and failure handling

- “Resident reminders ready” means the correct database generation is open, database/settings/native preference migration succeeded, initial queue reconciliation committed, and the native scheduler is active. Only the designated main initializer can acknowledge readiness for that generation.
- Before readiness, show booting/degraded state rather than a false enabled badge.
- Pause due-delivery validation when restore/relocate changes database generation; resume only after the replacement is ready.
- Validate live sources and rule watermarks immediately before delivery, preserving the earlier fixes for paid/deleted bills, contact changes, disabled rules, stale queues, and rollback.
- Preserve fired/dismissed terminal-history deduplication and source-key rules. Cancelled pending rows are tombstones, not terminal delivery history: preserve their existing ability to revive when the rule/source becomes valid again.
- OS API failure remains retryable and is logged without personal record contents.
- Bound retries and avoid notification storms after long suspension. Preserve the existing delivery semantics unless a separately tested catch-up policy is deliberately introduced.
- Start processing the first eligible batch no later than two normal scheduler intervals after readiness/resume. Preserve the existing 20-per-pass cap and drain larger backlogs fairly across later ticks; do not promise all overdue rows finish inside two intervals.
- OS acceptance of a notification is not proof that a visible toast appeared.

### 11.3 Hidden-reminder acceptance scenarios

1. Cold login launch with no main-window interaction opens/migrates the database and prepares the queue.
2. Hide main before a known bill/follow-up threshold date; crossing the date causes delivery without reopening main.
3. Suspend across a due time and resume; eligible notification is processed without duplication.
4. Mark bill paid, disable rule, delete source, or change contact while resident; obsolete rows never fire.
5. Change timezone/clock and reconcile scheduled local times without creating duplicate terminal notifications.
6. Restore/relocate while a tick is pending; the old generation does not deliver from stale data.
7. Quit actually stops reminders until the app runs again.
8. Native notification failure is distinguishable from success; Do Not Disturb is explained honestly.

Use injected clock/tick boundaries for fast automated cases plus a real installed-app scenario. Do not modify the user’s system clock or seed their production data.

## 12. Native preferences, autostart, and installer behavior

### 12.1 Preference ownership and migration

Store machine-local preferences in a dedicated native configuration file, for example desktop-preferences.json. Do not overwrite the existing settings.json data_dir configuration.

Preferences:

- closeToTray: new-install default true.
- closeExplanationSeen: false initially.
- autostart: opt-in only; actual OS registration is authoritative.

Legacy close preference:

- Inspect raw localStorage value orbit-close-to-tray, not the current boolean helper.
- Explicit “0” preserves off.
- Explicit “1” preserves on.
- Missing value adopts the new default.
- Transfer it once through a validated native command after frontend hydration; persist migration completion so it is not replayed on every boot.
- Resolve migration before honoring a user-initiated close. An unresolved legacy preference must not briefly behave as the new default.
- Show the first-time close explanation before the first user-initiated close-to-tray. Include how to reopen, where Quit is, and how to disable close-to-tray. Initial hidden autostart does not count as this action and does not itself force an explanation window.
- If explanation/settings cannot initialize, prefer a reachable visible window.

Importing domain data must never enable autostart, change OS registration, or move the native data directory.

### 12.2 Opt-in autostart

- Use the current Tauri v2 autostart plugin with an explicit background/login launch argument.
- Limit registration to the current user; no administrator rights or machine-wide registry entry.
- Enable/disable only from an explicit user action.
- Read back actual OS state after the operation and on Settings open.
- If enable/disable fails, show the real state and actionable error; do not optimistically leave the toggle incorrect.
- Refresh the registration target correctly after an installation path/version change.
- Do not enable login startup by default in the installer.

The plugin provides enable, disable, and enabled-state APIs, with startup arguments configured during initialization. [Autostart documentation](https://v2.tauri.app/plugin/autostart/).

### 12.3 Installed notification identity

- Preserve production identifier app.orbit.desktop and the Orbit product name.
- Verify executable, shortcut, installer, icon, and notification identity agree.
- Use an installed build for the identity check; a development notification under PowerShell does not prove packaged Orbit identity.
- Check the visible app name/icon and notification-center entry, not just a fired database row.
- Document Windows notification permission/settings and Do Not Disturb limitations.

Tauri’s notification documentation distinguishes installed Windows behavior from development notifications. [Notification documentation](https://v2.tauri.app/plugin/notification/).

### 12.4 Install, upgrade, and uninstall

- Add a narrowly scoped NSIS hook file and reference it through the existing Tauri bundle configuration.
- Resolve the exact autostart value written by the chosen plugin. Remove only Orbit’s matching owned value, never the entire Run key.
- Uninstall removes matching startup/shell artifacts, not the selected database directory, exports, backups, or unrelated preferences.
- Test upgrade behavior separately from uninstall: preserve opt-in state and update the executable target.
- Account for an upgrade invoking old uninstall hooks; do not accidentally lose the opt-in preference or recreate it after the user disabled it.
- Use the existing pre-release NSIS channel for the current alpha build.
- Stable policy also ships MSI. Either implement and verify equivalent MSI cleanup before shipping that channel, or record it as an explicit stable-release gate. NSIS hook success is not evidence for MSI.

Tauri supports NSIS installer hooks with named install/uninstall macros. They are NSIS-specific. [Windows installer documentation](https://v2.tauri.app/distribute/windows-installer/).

### 12.5 Isolated desktop tests

Extend test isolation beyond ORBIT_DATA_DIR and WEBVIEW2_USER_DATA_FOLDER:

- Native preference files and window-state files.
- App/test single-instance identity.
- Logs and crash markers.
- Autostart backend and registry namespace.
- Temporary installer/seed paths.

Use a test-build identifier separate from production and an injected/fake autostart backend for automated tests. Never register real login startup in the user’s profile, activate their running Orbit through single-instance forwarding, or broadly terminate all Orbit processes.

Real registry/install/reboot cases belong in an isolated Windows VM or disposable test account.

## 13. Day-by-day execution plan

### Day 1 — Baseline, contracts, and fixtures

- Record baseline gates and pre-existing failures.
- Agree detector formulas, period boundaries, suppression behavior, and lifecycle matrix from this plan.
- Define insight/evidence/settings types.
- Design old-record normalization and version-4 export fixture path.
- Create deterministic fixtures for all five detectors and native resident states.
- Identify shared files before splitting work across developers.

Exit gate: the expected output for every detector is written as a failing test, and native lifecycle states have explicit expected transitions.

### Day 2 — Persistence and shared data foundations

- Extend settings and InsightState schemas.
- Normalize memory/IndexedDB/SQLite reads and import/restore paths.
- Implement owned-transaction state upserts and fresh nested-settings merge.
- Add backward-compatibility and duplicate-state tests.
- Create indexed snapshot/activity/session-total helpers.

Exit gate: old data remains usable; new state survives reload/export/import without changing shipped fixtures.

### Day 3 — Estimate, stale, and person detectors

- Implement estimate bias with real sample evidence.
- Unify project activity and threshold consumers.
- Implement open commitments per person.
- Validate deterministic output and deleted/missing-reference behavior.

Exit gate: all three detectors pass threshold and evidence tests; existing project/goal health tests remain green.

### Day 4 — Capacity and weekly deficit

- Add full-day diagnostic capacity separately from remaining planner capacity.
- Implement exact day demand and unscheduled acceptance policy.
- Implement next-full-week area-target comparison.
- Add date, overlap, zero-capacity, split-block, and no-double-count tests.
- Leave planner placement/buffer semantics unchanged.

Exit gate: hand-calculated fixtures reconcile to every displayed total, and clock advancement alone does not inflate today’s overload.

### Day 5 — Shared service and Insights page

- Implement snapshot caching, suppression, history, and refresh triggers.
- Build cards, severity groups, evidence expansion, loading/error/empty states.
- Wire transactional snooze/dismiss/restore.
- Test exact expiry and relevant/unrelated source changes.

Exit gate: a user can understand and suppress an insight, reload, and see the correct persisted result.

### Day 6 — Integrate Today, health, Timeline, and settings

- Replace Today stub and cap unsuppressed cards at three.
- Extend shared badges and threshold propagation.
- Implement actual date/block evidence navigation.
- Preserve the neglected-goals command and add Open insights.
- Add threshold settings, error handling, accessibility, and two-window refresh coverage.

Exit gate: all surfaces agree; every evidence action has a working destination.

### Day 7 — Native lifecycle and tray

- Register single instance first.
- Add lifecycle coordinator, native preference API, and visibility policy.
- Implement tray/menu/hotkey routing and graceful scheduler shutdown.
- Keep hidden main providers and database alive.
- Add isolated native lifecycle tests.

Exit gate: close hides when enabled; explicit Quit exits; duplicate launch cannot create another scheduler or corrupt the crash marker.

### Day 8 — Resident reminder correctness

- Materialize known future reminder rows.
- Replace stale relative notification copy with date-stable wording.
- Add readiness handshake and reconciliation triggers.
- Verify cancellation, deduplication, restore, and cross-window source edits.
- Exercise hidden-midnight and resume scenarios with deterministic clocks.

Exit gate: reminders become due and are delivered with main hidden, without opening it to create the queue.

### Day 9 — Autostart and native Settings

- Add per-user opt-in registration and actual-state read-back.
- Complete legacy close-preference migration and first-hide explanation.
- Test normal launch versus background launch, including initialization failures.
- Isolate test settings, identity, and autostart effects.
- Verify web/PWA correctly reports unsupported native capabilities.

Exit gate: login-start mode is operational and explicit opt-in persists safely across restart.

### Day 10 — Packaging and installed Windows pass

- Add exact-value NSIS cleanup and upgrade preservation.
- Build the alpha NSIS installer using the current release policy.
- Verify installed Orbit name/icon notifications.
- Run install→opt in→reboot→hidden reminder→upgrade→disable→uninstall in a clean VM.
- Record screenshots, build/Windows versions, expected/actual results, and retained user-data checks.

Exit gate: the NSIS resident experience is verified on an installed build. If the VM is unavailable, mark this gate pending; do not mark resident delivery complete.

### Days 11–12 — Regression, performance, and handoff

- Run full TS, Rust, browser, desktop, migration, roundtrip, and backup gates.
- Benchmark the real five-detector engine with full evidence on the 50k world.
- Fix regressions and excessive recomputation before changing performance budgets.
- Complete keyboard/screen-reader/high-contrast/DPI checks.
- Write docs/RESIDENT-BEHAVIOUR.md and docs/INSIGHTS.md.
- Update roadmap cross-references, verified checkboxes, and release notes.
- Prepare reviewable commits and a concise verification report.

Exit gate: section 16 is satisfied, with no required check hidden behind a generic “tests pass.”

Contingency days are for Windows installer/reboot issues or a genuine performance regression, not for adding Week 12 features.

## 14. Verification gates and commands

Run commands from C:\Orbit. These are implementation-time gates; their presence here does not mean they have already passed for Week 11.

### 14.1 Fast focused loops

Name new tests so these filters find the intended suites, and confirm each command actually runs tests:

```powershell
pnpm exec vitest run --project core insights
pnpm exec vitest run --project storage insights settings
pnpm exec vitest run --project orbit insights settings timeline
cargo test --manifest-path apps/orbit/src-tauri/Cargo.toml
```

Add the native lifecycle/scheduler unit tests to CI explicitly; compilation and clippy alone do not execute them.

### 14.2 Full automated gate

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

Also run the roundtrip suite at ROUNDTRIP_SIZE=50000 using a temporary process environment setting; restore any previous value afterward. Use the repository’s matching WebDriver setup for desktop E2E.

Current coverage floors remain:

- Core: 90% lines/statements/functions.
- Storage: 85% lines/statements/functions.
- App: 70% lines/statements and 65% functions.

Do not lower coverage, omit difficult lifecycle tests, or regenerate performance baselines merely to make the gate green.

### 14.3 Performance

- Replace the placeholder insights benchmark with the actual full computeInsights call, including indexing and complete evidence construction.
- Retain the existing 200ms mean budget on the 50k-world workload; record machine/build details and sample distribution.
- Keep old search, planner, recurrence, and capture budgets passing.
- Measure repository loading and UI rendering separately so a fast pure engine does not conceal a slow page.
- Confirm only one computation per snapshot generation, even with Today, badges, and Timeline consumers mounted.
- Use pagination/virtualization for large evidence; do not omit source rows from totals.
- If optimization is required, first fix repeated scans, repeated parsing, and redundant subscriptions.

### 14.4 Installed build

For the current prerelease channel:

```powershell
pnpm --filter orbit exec tauri build --bundles nsis
```

Do not treat a no-bundle binary, a development run, or a notification row marked fired as proof of installer/autostart/notification identity correctness.

Do not publish, tag, or change application version merely to execute these local checks.

### 14.5 Required test matrix

| Area              | Minimum evidence                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| Estimate bias     | 4/5 samples, exact ratio boundary, explicit/session actuals, zero/missing/future data                             |
| Project staleness | Exact threshold, all activity sources, tombstones, shared consumer agreement                                      |
| Day overload      | Exact 110%, zero capacity, overlapping exclusions, split/done/manual/event blocks, removed blocks, grid fallback  |
| Weekly targets    | Count each area once, real settings, next full week, weekend/reservation semantics                                |
| People            | 2/3 boundary, both directions, closed/deleted/missing records                                                     |
| Suppression       | Reload, exact expiry, time-only changes, relevant/unrelated edits, permanent dismissal, restore/history           |
| Storage           | Three adapters, duplicate state, fresh settings merge, export v1–4, backup restore, generation replacement        |
| UI                | At most three after suppression, stable order, exact record/date/block links, empty/error/history, keyboard/focus |
| Cross-window      | Capture/source edits, snooze in another view, stale snapshot cancellation, import/restore refresh                 |
| Native lifecycle  | Manual/background startup, readiness failure, close on/off, tray failure, second launch, clean/unclean shutdown   |
| Reminders         | Hidden overnight, resume, native API failure, source/rule cancellation, dedupe, restore/relocation races          |
| Autostart         | Explicit opt-in, actual-state read-back, failure, upgrade target, safe uninstall, no host-profile test effects    |
| Packaging         | Installed Orbit identity, clean-VM reboot, taskbar DPI/themes, NSIS cleanup and separate MSI release gate         |

### 14.6 Manual fixture and VM procedure

Prepare a disposable dataset using the test harness/import path; do not depend on unfinished Week 12 forms.

Seed:

- Five or more completed tasks in one area with known estimates and actuals.
- One active project with activity exactly beyond the stale threshold.
- A deliberately overloaded date with named blocks and an unscheduled accepted task.
- Area targets above next week’s known capacity.
- One person with three open commitments in mixed directions.
- A valid bill/follow-up rule with a documented threshold date and reminder time.

The roadmap’s “bill due in 1 minute” example does not match current date-based 09:00 scheduling. Use a test-only seeded pending row to verify near-term delivery, then a separate real threshold-date scenario to verify queue preparation.

Record:

1. Baseline screenshots and exact expected arithmetic.
2. Evidence navigation and snooze/reload/restore.
3. New install with autostart off.
4. First close explanation, tray recovery, capture, and Plan my day.
5. Explicit enable, reboot/login, hidden initialization, and reminder delivery.
6. Sleep/resume across a due boundary without duplicate delivery.
7. OS notification-disabled/Do Not Disturb behavior and truthful UI.
8. Upgrade with opt-in retained and current executable target.
9. Disable, reboot, and absence of auto-launch.
10. Uninstall cleanup and preserved database/backups.
11. Explicit Quit, then normal launch without a false crash report.
12. Forced termination in the disposable environment, then one honest unclean-run report and recovery.

Mark PASS, FAIL, or NOT RUN per scenario. A missing VM is a verification dependency, not permission to claim the gate passed.

## 15. Planned file map and commit checkpoints

Names below describe the intended organization; adapt within the existing conventions without parallel duplicate implementations.

### Core and storage

- packages/core/src/insights/types.ts
- packages/core/src/insights/settings.ts
- packages/core/src/insights/evidence.ts
- packages/core/src/insights/estimateBias.ts
- packages/core/src/insights/staleProjects.ts
- packages/core/src/insights/dayLoad.ts
- packages/core/src/insights/goalDeficit.ts
- packages/core/src/insights/personCommitments.ts
- packages/core/src/insights/state.ts
- packages/core/src/insights/index.ts
- Existing schema, health, estimate, and reminder helpers.
- Shared storage normalizers and adapter/export/import tests.
- New version-4 export fixture and dedicated state/old-record behavior fixtures.

### App

- apps/orbit/src/features/insights/insightService.ts
- apps/orbit/src/features/insights/useInsights.ts
- apps/orbit/src/features/insights/InsightsPage.tsx
- apps/orbit/src/features/insights/InsightCard.tsx
- apps/orbit/src/features/insights/InsightEvidence.tsx
- apps/orbit/src/features/insights/InsightHistory.tsx
- Existing Today, structure, HealthBadge, Timeline, Settings, palette, route, and platform files.
- Targeted browser and app tests beside the relevant feature suites.

### Native and packaging

- apps/orbit/src-tauri/src/resident.rs or lifecycle.rs
- apps/orbit/src-tauri/src/tray.rs
- apps/orbit/src-tauri/src/autostart.rs
- Native preference module and narrowly scoped commands.
- Existing lib.rs, scheduler.rs, logging, capabilities, Cargo/configuration files.
- apps/orbit/src-tauri/windows/hooks.nsh
- Isolated resident desktop E2E fixtures/configuration.
- scripts/bench.ts and affected CI test steps.

### Documentation

- docs/INSIGHTS.md: formulas, defaults, evidence, suppression, and limitations.
- docs/RESIDENT-BEHAVIOUR.md: lifecycle policy, settings ownership, recovery, and installed-VM evidence.
- Roadmap cross-references, test/fixture documentation, and release notes.

Suggested commit boundaries after the relevant gates pass:

1. feat(core): add explainable insights and compatible state.
2. feat(app): add insights page and shared health surfaces.
3. feat(desktop): add resident lifecycle and tray.
4. fix(reminders): prepare reliable resident notification queues.
5. feat(desktop): add opt-in autostart and installer cleanup.
6. test(docs): verify week 11 behavior and document boundaries.

Each checkpoint should remain buildable and include its own relevant tests. Do not commit or stage unrelated files by default. This planning task itself does not perform these implementation commits.

## 16. Definition of done

### Insights

- [ ] All five detectors follow the exact definitions above.
- [ ] Each observation has typed, non-empty evidence and a visible threshold.
- [ ] Minimum samples and strict/inclusive comparison boundaries are correct.
- [ ] Today uses at most three unsuppressed insights from the shared engine.
- [ ] Shared project/goal health remains consistent across consumers.
- [ ] Timeline evidence opens the correct date and exact block.
- [ ] Suppression/history survives restart, concurrent actions, import, and restore.
- [ ] Clock boundaries and cross-window edits refresh without write loops.
- [ ] Old settings/state normalize safely; export/import compatibility is verified.

### Resident desktop

- [ ] Manual and login launch have different, reliable visibility behavior.
- [ ] Exactly one instance owns database/scheduler/crash marker state.
- [ ] Close-to-tray hides without database/provider teardown.
- [ ] Tray Open, Capture, Plan my day, and Quit work.
- [ ] Failure to create tray or initialize background state leaves a reachable app.
- [ ] Quit stops background work and respects transaction ownership.
- [ ] Known future reminders are prepared and delivered while main is hidden.
- [ ] Autostart is opt-in, machine-local, and based on actual OS state.
- [ ] Legacy close preference and first-time explanation are handled.
- [ ] Installed NSIS notification identity, reboot, upgrade, and uninstall are verified.
- [ ] MSI behavior is either verified for a shipped channel or explicitly blocked as a future stable-release gate.

### Quality and handoff

- [ ] Full automated gates and existing Week 8–10 regressions pass.
- [ ] Actual full-engine 50k benchmark meets its budget.
- [ ] Native/browser test isolation cannot affect the user’s running installation.
- [ ] Keyboard, focus, severity text, theme, and DPI checks pass.
- [ ] Documentation records exact semantics and genuine verification results.
- [ ] Required manual checks are not mislabeled complete.
- [ ] No cloud service, telemetry, automatic updates, or Week 12 feature expansion was introduced.

## 17. Final recommendation

Start with the data contracts, compatible persistence, and full-day capacity calculation. They determine whether the insights can be trusted.

Build the desktop lifecycle before treating the tray as finished, and make hidden reminder preparation a first-class acceptance gate. Then add opt-in autostart and prove the result with an installed Windows build.

If time is limited, split delivery into Week 11A (insights) and Week 11B (resident desktop verification). Keep both parts on the milestone checklist; do not drop evidence, state persistence, hidden-reminder correctness, or installer testing to fit an artificial five-day deadline.
