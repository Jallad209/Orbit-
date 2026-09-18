# Bills

A `kind: 'bill'` record is one occurrence: one amount due on one date. A recurring bill is a chain of
occurrences generated one at a time from an original schedule — paying an occurrence
creates at most one successor. Orbit records payments; it never sends or executes them.

The pure rules are `packages/core/src/services/bills.ts` (grouping, totals, validation,
schedule preview, successor planning, the pay/unpay/stop/edit transitions); the
transaction-owning service is `apps/orbit/src/features/bills/billsService.ts`; the screens
are `BillsPage` (`/bills`), `BillPage` (`/bills/:id`), and `BillForm`.

## The occurrence model

| Field              | Meaning                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `seriesId`         | Groups the occurrences of one original schedule; `null` for a one-off                                        |
| `recurrenceAnchor` | The original schedule date; never moved to a clamped date (a 31st stays the 31st)                            |
| `occurrenceIndex`  | Zero-based position under the original rule; COUNT is measured from the rule, so COUNT=1 allows index 0 only |
| `scheduledFor`     | The date the schedule put this occurrence on; unchanged by a deadline edit                                   |
| `dueAt`            | The deadline shown and reminded; may be edited for this occurrence only                                      |
| `paidAt`           | When the payment was recorded; `null` on legacy paid rows means "not recorded", never a made-up time         |
| `nextBillId`       | The one successor generated from this occurrence's payment                                                   |
| `repeatStopped`    | This occurrence ends the chain; the recurrence description and history stay                                  |
| `dueTime`          | Optional minute of day for display and reminder delivery                                                     |

The recurrence (rule, interval, COUNT, UNTIL) travels with the chain unchanged. Records
from before Week 12 normalize on read as roots anchored at their own `dueAt` with
`scheduledFor = dueAt` and index 0, using the bill's own id as its series identity; nothing
is generated, back-dated, or paid by normalization.

## Screens

`/bills` groups by what needs attention, following the local date (groups move at midnight
and when the window comes back):

| Group    | Rule                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overdue  | unpaid, live, `dueAt` before today                                                                                                                         |
| Due soon | unpaid, today through today + 3 local dates inclusive — a fixed product rule, distinct from a reminder rule's configurable lead time, and labelled as such |
| Upcoming | later unpaid                                                                                                                                               |
| Paid     | paid occurrences, read-only, filterable by series                                                                                                          |
| Deleted  | explicit recovery view, outside the totals                                                                                                                 |

Totals are per currency and never added across currencies; an empty currency is shown as
"currency not set". Amounts must be finite and non-negative; existing decimal amounts are
stored as they are.

`/bills/:id` shows this occurrence — its money fields and deadline (editable while unpaid),
its place in the schedule and a recurrence summary so "this bill" and "the schedule" are not
confused, Mark paid with the generated successor, Stop repeating, a confirmed Delete that
explains what stops, and read-only paid history with the one-off correction. A recurring
row is always this occurrence, never "the latest one".

## Creating

The first scheduled date must agree with the rule (a weekly rule on Mondays cannot start on
a Tuesday, a monthly rule on the 15th cannot start on the 3rd); the form asks to adjust one
or the other rather than silently moving either, and previews the next dates.

## Mark paid

One atomic, idempotent operation: inside one transaction the current occurrence is
re-read, the paid row keeps its identity, amount, and deadline and gets `paidAt`, at most
one successor is created, obsolete reminder rows are cancelled and the successor's
prepared, and — inside a weekly review — the receipt is appended. Either everything lands
or nothing does.

- An already-paid bill returns its stored payment and successor; no second successor.
  Double clicks, retries after an uncertain response, and two windows paying at once all
  resolve to one successor.
- A deleted bill is refused.
- The successor is the next scheduled date after `scheduledFor` under the original anchor
  and rule — never after the payment time or an edited deadline. A late payment still
  generates the missed installment, even one already overdue; missed bills are not skipped.
- When COUNT or UNTIL is exhausted no successor is created and the page says "Series
  finished". Expansion is never unbounded.
- "Fired" reminders for the paid occurrence are history; a paid or changed source stops an
  obsolete notification from firing (the scheduler re-validates before delivery).

## Editing

- Title, amount, and currency edits apply to this occurrence and are copied into a
  successor generated later from it. Already-generated later occurrences are not rewritten.
- A due-date edit moves only this occurrence's deadline; `scheduledFor` and the anchor are
  untouched, so later occurrences do not drift.
- Changing the recurrence pattern of a started series is not an in-place rewrite of its
  history; it is a new series.

## Stop repeating

Sets `repeatStopped` on the latest unpaid occurrence of a series — the only place it is
offered. The recurrence description and paid history stay as they are and that unpaid bill
is not deleted; paying it generates nothing.

## Corrections

- A one-off (or a recurring occurrence that generated no successor) can be returned to
  unpaid, clearing `paidAt`, through a validated action.
- Reversing a recurring payment that generated a successor is refused and explained: that
  is a grouped operation this milestone does not offer. There is no generic paid/unpaid
  toggle.
- Retrying an old parent payment never resurrects a deliberately deleted successor.

## Deleting and restoring

Delete is a confirmed soft delete of the selected occurrence only; lineage and links are
kept. The confirmation explains the consequence: deleting the latest unpaid occurrence of
a series stops generation, because nothing remains to pay. Restore is explicit and follows
the normal reminder rules; nothing is generated on read.

## Legacy paid rows

A row paid before successors were linked is never advanced automatically — not on
migration, page load, or a replayed payment. The bill page shows the assumed anchor and
offers an explicit "Create next occurrence", which uses the same transactional successor
lookup as a payment.

## Recurrence engine

The Week 6 engine (`packages/core/src/recurrence`) is the only source of next dates. Week
12 corrected its shared weekly ordering and covered: monthly on the 31st (Jan 31 → Feb 28/29
→ Mar 31), intervals greater than one keeping the anchor day, COUNT=1 allowing position zero
only, inclusive UNTIL, Sunday plus Monday in a narrow range returning the next chronological
date, and duplicate weekdays not consuming COUNT twice.

## Limitations

- No bill-series record: the chain is the occurrences plus their links. Series-wide edits
  are "edit this one, and the next inherits".
- No payment execution, bank data, or currency conversion.
- Reversing a payment with a successor waits for a fully tested grouped reversal.

## Spending log

The Spending panel uses the same store with `kind: 'expense'`. An expense is a recorded
purchase, not a payable bill: `dueAt` is nullable, recurrence and payment actions do not
apply, and the panel groups normalized item names for the selected month. Totals are kept
separate by the row's currency; Orbit does no currency conversion.

The optional month reminder is a direct `monthly-spending` reminder, not a rule-derived
bill reminder. It opens `/bills`, remains live only while its pending source row is live,
and is reconciled when spending settings change.
