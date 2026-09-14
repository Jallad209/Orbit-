# Insights

Insights are observations Orbit makes about your own data, each with the records and the
arithmetic behind it. Nothing here predicts, learns, or changes your data: an insight is a
calculation over what is already stored, run locally, with a threshold you can see and set.

The engine is `packages/core/src/insights` (`computeInsights`). It is pure: a snapshot of
records, the settings, and a clock go in; observations come out. Reading insights never
writes a record.

## What each observation means

All defaults can be changed in Settings → Insights and are shown on every card.

| Observation                        | Severity  | Default trigger                                               |
| ---------------------------------- | --------- | ------------------------------------------------------------- |
| Overloaded day                     | Risk      | committed work > full-day capacity × 1.1, today + 6 days      |
| Weekly area targets exceed time    | Risk      | Σ area weekly targets > Σ full-day capacity of next full week |
| Stale project                      | Attention | ≥ 10 complete days since the project's last activity          |
| Estimate bias                      | Attention | recorded ÷ estimated > 1.3 over ≥ 5 completed tasks, 30 days  |
| Many open commitments with someone | Info      | ≥ 3 open commitments with one person                          |

Within a severity the order is fixed: overloaded days, weekly targets, stale projects,
estimate bias, people. Ties break by date, then subject, then key. Identical data gives
identical output; the order records were stored in never changes anything.

### Estimate bias

Per area (a task's own area, else its project's; "Unassigned" when none resolves to a live
area): the sum of recorded minutes divided by the sum of estimated minutes over live completed
tasks whose `completedAt` falls in the inclusive window `[now − 30 days, now]`.

- A task counts only with an estimate above zero and a recorded actual. An explicit
  `actualMin` wins, including an explicit zero; otherwise the task's closed sessions that
  ended by now are summed. Running sessions and future intervals are not history.
- Sums first, then one division. Five ten-minute tasks and one long task on time do not
  average into a bias.
- Strict: exactly 1.30× is quiet. Fewer than 5 samples means "insufficient data", which the
  page says; it is not silence.
- The wording describes recorded time. It says nothing about productivity or about a
  statistically proven population bias.

### Stale projects

One definition of activity for the whole app (`services/activity.ts`): the newest of the
project record's own change, any change to a task or milestone that belongs to it, and any
session on one of its tasks. A soft-deleted task or milestone counts through its tombstone,
because deleting work is doing something to the project; tombstones count for nothing else.
Snoozing or dismissing the insight is not activity, nor is looking at the project.

Stale means at least `staleProjectDays` complete 24-hour periods since that activity. Future
or unreadable timestamps count as zero days. The project badge on every list uses the same
number and the same threshold, so the badge and the card cannot disagree.

### Overloaded days

For today and the six dates after it, **committed work** against **full-day capacity**.

Capacity is the whole date, not what is left after now:

1. the saved working window;
2. minus rest boundaries, calendar events, and whole (no-area) reservations from enabled
   constraint rules, each clipped to the window, overlaps counted once;
3. area reservations stay usable time (they are listed in the evidence);
4. energy rules constrain where work goes, not how much fits;
5. work blocks are not subtracted here — they are demand — and neither is the time already
   passed today.

This is deliberately not the planner's remaining free time (`buildCapacity().freeMin`), which
subtracts fixed blocks and elapsed time and would double-charge work and make every
afternoon look overloaded.

Demand is every live task or routine block on the date by its own stored length (overlaps
add up — they are competing commitments), live manual blocks, plus each accepted task with
no block left on the date, counted once at its estimate after the planner's rounding
(minimum 15, snapped up to 15); a zero estimate uses the default estimate. Event blocks are
not demand (their event already reduced the capacity). Blocks of deleted or archived tasks,
skipped instances, or instances without a routine are ignored. Done tasks and done
routines still count: this measures what the day was booked with. Blocks outside the working
window count and are marked so you can see why the window is exceeded.

Committed work excludes transition buffers. The planner still reserves its buffer while
placing work; this detector does not change that. Every card says: _Workload comparison
only. Buffers, fragmented gaps, area reservations, and energy restrictions can make a plan
infeasible even below this threshold._ With no available time and any booked work, the
threshold shown is "committed minutes > 0" — never a ratio, never Infinity.

The Timeline header shows the same result for the selected date; a date outside the seven-day
horizon runs the same calculation directly.

### Weekly area targets

The next full Monday–Sunday week strictly after the current one. Required minutes are
60 × the sum of positive `weeklyHoursTarget` values of live areas, each area once whatever
its goals (an area target is your commitment even with no active goal). Available minutes
are the seven full-day capacities above added up. A deficit above zero is reported.

Every date uses the working window; there is no weekday preference, so weekends count unless
a reservation or event blocks them. Scheduled work is not subtracted: it may already be
fulfilling the targets. This is aggregate capacity, not a proof that every hour can be placed
under area, energy, and buffer rules. Goal badges keep their own neglect signal; a goal is
never called "over capacity" because the area total is high.

### Open commitments per person

Live open commitments per live person, both directions, with the subtotals shown ("3 you
owe and 1 owed to you"). Done, dropped, and deleted commitments and deleted people are not
counted. "Owed to you" items are not obligations of yours.

## Evidence

Evidence is the proof, not another warning. Rows are typed (`packages/core/src/insights/types.ts`):

- task estimate and recorded actual, with where the actual came from;
- the record responsible for a project's last activity;
- each counted block (date, time, minutes, whether it is outside the window or done) and
  each accepted-but-unscheduled task with the minutes it was counted at;
- each date's capacity breakdown: window, every exclusion, area reservations, the total;
- each counted area target;
- each open commitment with its direction and due date.

The page shows 25 rows at a time with the total; nothing is cut from the totals. Every row
opens something that exists: a project page, the Timeline at that date (and block), the
settings section that owns a rest boundary or rule, or the read-only preview for a task or
person. Evidence is read-only.

## Coverage: an empty list is not "all clear"

`computeInsights` returns, per detector, how many subjects it looked at, how many had enough
data, and why it could not judge otherwise. The page shows these as plain sentences
("Estimate bias needs 5 completed tasks with an estimate and a recorded actual in one area;
the most any area has is 3"). Orbit never says everything is healthy because the list is
empty or because everything was dismissed.

## Snooze, dismiss, restore

| Action             | Behaviour                                                                    |
| ------------------ | ---------------------------------------------------------------------------- |
| Snooze 1 day       | hidden for exactly 24 elapsed hours from the action                          |
| Snooze 1 week      | hidden for exactly 7 × 24 elapsed hours                                      |
| Until data changes | hidden while the insight's source fingerprint equals the one recorded        |
| Dismiss            | hidden for this key until you restore it, whatever the numbers do            |
| Restore            | suppression cleared; the next computation shows it again if it still applies |

A timed snooze stays in force through source edits until its deadline and stops at the exact
instant. A dismissal does not come back because the numbers changed; use "until data
changes" for that. A dated observation has a dated key: dismissing this Wednesday's overload
does not dismiss next Wednesday's. History lists every snoozed and dismissed observation with
when and how, and Restore.

The **fingerprint** hashes the sorted semantic source values behind the observation and the
settings that apply: the sampled tasks' estimates and actuals; a project's last activity;
the day's counted blocks, unscheduled tasks, and capacity inputs; the area targets and the
week's capacity inputs; the open commitments. Time alone never changes it; a sample ageing
out of the estimate window is not a source edit. The algorithm version is part of it, so a
deliberate change of meaning lifts an until-change snooze; a dismissal is keyed on the stable
key and survives.

State is stored as `InsightState` (one row per key, id a UUID, key a lookup) and written in
one transaction that re-reads the current rows, merges legacy duplicates into the newest
one, and retires the rest. Reading a page never writes.

## Refresh

One computation per data generation, shared by the Insights page, Today's strip, and the
Timeline header. It refreshes after a local write (debounced), at the next time boundary the
last report named (snooze expiry, a project crossing its stale threshold, the oldest estimate
sample leaving its window, local midnight — one timer, not one per card), on window focus or
visibility when the op-log head moved (another window's commit) or a boundary passed, and on
request. A read against a repository that has been replaced (restore, relocation) is dropped.
If a refresh fails the previous view stays, marked stale, with Retry.

## Settings and compatibility

Thresholds live in the settings document (`AppSettings.insights`): stale project days (1–90),
estimate window (7–180 days), estimate minimum samples (5–100), estimate ratio (1.05–3),
day overload ratio (1–2), person commitment count (1–20). Values are validated in the form
and again at the storage boundary; an out-of-bounds value is refused visibly. Restore
defaults touches only this group.

Old data: a settings document without the group gets the defaults; a present but malformed
value is repaired to its default and reported. An insight state from before week 11 with a
non-null `snoozedUntil` becomes a timed snooze; a dismissal stays permanent; history shows it
as "a previously dismissed observation". These rules run at every read boundary (memory,
IndexedDB, SQLite), on import, and on restore. Export schema is 4; older Orbit refuses a v4
file rather than dropping fields; this Orbit reads v1–v3 with defaults.

## Limitations

- Estimate bias groups by area only. There are no task tags or types to group by.
- Overload and weekly deficit compare minutes, not feasibility. A day can be under the line
  and still not plan because of buffers, gaps, area windows, or energy rules.
- Weekly targets are area targets; goals have no hour requirement of their own.
- The engine reads the whole repository once per generation. On the 50 000-task benchmark
  world it stays within the 200 ms budget (`pnpm run bench`), but a page can still be slow
  for other reasons; loading and rendering are measured separately.
