# Weekly review

The weekly review is a guided pass over one week: inbox, overdue work, projects, goals,
bills, patterns, and next week's capacity, in that order, ending in a frozen summary. It can be paused
and resumed, every decision it applies is recorded as a receipt, and nothing it shows is
changed by merely looking at it.

The pure rules live in `packages/core/src/services/weeklyReview.ts` (which weeks a review
covers, how it moves between steps, what an acknowledgement records, the capacity
comparison); persistence, receipts, and conflicts live in
`apps/orbit/src/features/reviews/weeklyService.ts`; the screen is
`apps/orbit/src/features/reviews/WeeklyFlow.tsx` with one component per step under
`reviews/weekly/`.

## Starting, resuming, history

`/review/weekly` is the landing. Opening it — or any URL — never starts a review and never
submits anything; Start and Resume are the user's explicit intent.

| Control             | Effect                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start this week     | Creates a review for the local week holding today (`reviewWeekStart` = that Monday) planning the following week (`targetWeekStart`), both frozen at that moment            |
| Resume              | Reopens the unfinished review at its saved step with its original dates; if that period is older than this week the landing says so and offers "Start this week" beside it |
| Completed summaries | Read-only history, newest first; a completed review is never edited                                                                                                        |
| Review again        | A new record beside the completed one for the same week; the earlier summary stays                                                                                         |

Start-or-resume is serialized inside one transaction, so a second Start while a review of
the same week is unfinished resumes it instead of creating a duplicate. Imports can still
bring duplicate unfinished reviews: every record is preserved, the canonical one to resume
is chosen deterministically (newest change, then earliest week, then smallest id), and the
others are listed rather than merged.

`?review=<id>` opens exactly that record; a missing or deleted id shows a safe missing
state. Resuming after Monday keeps the original review and target weeks.

## The seven steps

| Step     | What it shows                                                                             | Actions                                                                                                                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| inbox    | Captures and inbox tasks                                                                  | Convert a capture with the existing prompts (an already-processed capture returns its original reference); archive it; triage a task (assign its parent and open it); defer                                                                      |
| overdue  | Overdue tasks, with the live blocks holding each                                          | Reschedule with the existing date rules (the result says which blocks stayed put); return to inbox; archive (clears a project's next-action pointer to it); complete through the existing completion flow; keep/defer                            |
| projects | Every active project's health, tasks and milestones, last activity                        | Set the next action from a live open task of that project (revalidated at save); create a task and select it in the same transaction; edit the outcome with a conflict-aware patch; archive with the existing cascade preview; acknowledge/defer |
| goals    | Goals and area weekly-hours targets                                                       | Update importance/target date; mark achieved or dropped; edit an area's weekly target in its own labelled control; acknowledge/defer                                                                                                             |
| bills    | Unpaid bills overdue or due through the end of the target week (late successors included) | Mark paid (atomic, successor shown — see `docs/BILLS.md`); open the bill; defer without paying or dismissing its reminder                                                                                                                        |
| patterns | The completed week's time, completion, energy, reflections, tags, coverage, and spending  | Inspect the report and acknowledge it; spending totals remain separate by currency                                                                                                                                                               |
| capacity | Next week's booked work and area targets against available time                           | Acknowledge                                                                                                                                                                                                                                      |

The closing summary is the end of the seventh step, not an eighth.

Patterns is a frozen-window calculation over the review week. Its fingerprint includes
sessions, completed tasks, blocks, day commitments, daily reflections, and expense rows,
so changing any source invalidates a stale acknowledgement. Journal prose is excluded;
only explicit ratings and tags participate.

## Step completion

- Each item in a step is acted on, acknowledged, or explicitly deferred. An empty step is
  acknowledged and advanced. "Defer" keeps the item unresolved and records that decision
  (with an optional reason); the unresolved count is shown at Finish. Nothing is marked
  healthy by deferring it.
- Acknowledging a step records a fingerprint of what was shown and the counts (resolved,
  deferred, remaining). Editing an earlier step changes live data; later acknowledgements
  whose fingerprints no longer match are dropped, so Finish asks about those steps again.
- Back never reverses a committed change.
- No transaction stays open while a screen is being read. Every submission opens its own.
- Pause saves a bounded, versioned step draft of unsubmitted choices (at most 200) with
  the fingerprints they were made against. Saving the draft applies nothing and marks
  nothing reviewed; Resume restores it for an explicit Apply, and a choice whose source
  changed underneath is shown as changed rather than applied.

## Receipts and idempotency

Every mutating submission carries an action id generated when the user submits; a retry
of an uncertain request reuses it. The receipt is stored under that id
(`weeklyReviewActions`: review, step, kind, affected refs, source fingerprint, choice,
compact result, time, and `supersedes` for a later correction) in the same transaction as
the domain change and the review's revision bump — together or not at all.

- Same id, same review, same payload: the stored result is returned and nothing is
  repeated. An already-processed capture returns its processed reference; an already-paid
  bill returns its stored successor; a repeated Finish returns the same completed review.
- Same id for a different review or payload: refused as a validation error.
- A stale revision (another window moved the review) is refused before anything runs, and
  the inputs stay on screen for a retry.
- A failed transaction leaves neither the result nor the receipt.
- Receipts are immutable history. A correction is a new action that refers to the earlier
  one; deleting a review soft-deletes its history only and reverses nothing in the domain.
- Receipts are read in pages and tallied into counts; the review never stores a growing
  array of them.

Buttons are disabled while a submission is in flight, but correctness across windows
comes from the receipt, not the button.

## Finish

Finish flushes any valid draft, rechecks the review's revision and every step's current
fingerprint, and shows what would have to be acknowledged: steps whose data changed since
they were acknowledged, deferred items, and steps not yet acknowledged. Only after that
acknowledgement does one transaction set the review to completed with its compact summary:
the review and target weeks, each step's outcome and counts, the action count, the
deferred and unresolved references with their labels, and the capacity totals.

## Capacity arithmetic

`weekCapacity` calls the shared `computeDayLoad` for each date of the frozen target week
(so it works for a review resumed weeks later, not "next week from now") and sums committed
minutes and full-day capacity. It reports two separate comparisons: booked work against
available time, and area weekly targets against available time. They are never added
together — booked work may already be fulfilling those targets. Daily overload warnings use
the saved Insights threshold (default: strictly above 110 %). Buffers are excluded from
both figures, and neither is a proof that the hours can be placed under area, energy, or
buffer rules.

## Storage

`weeklyReviews` and `weeklyReviewActions` arrived with SQLite migration 3, IndexedDB
version 4, and export schema 5; older exports load with the two stores empty, and every
earlier version keeps its fixture (`tests/fixtures/{sqlite,idb,export}`). Reviews are not
indexed for search and are not part of generic command undo: their actions are explicit
and their history is the receipt store.

## Limitations

- The step structure is fixed for the current `flowVersion`; a future change to the steps is a new flow
  version, not an edit of stored reviews.
- Review actions are not undoable through the palette. Reopen and Restore exist where the
  underlying record offers them.
- The summary is compact by design; the receipts are the full record.
- Snapshot loading and receipt lookup are not benchmarked on the 50 000-task world yet
  (planned in the Week 12 plan §14); the engine-level rules are pure and cheap, but page
  timing has not been measured.
