# People and commitments

A person is someone Orbit knows; a commitment is a promise between you and that person,
in one direction ("I owe" or "owed to me"), with its own status. Contact with a person and
completion of a promise are two different facts and two different actions.

The shared rules are `packages/core/src/services/people.ts` (open-commitment counts,
ordering, the follow-up baseline, recording contact, status transitions, validation), used
alike by the screens, the "many open commitments" insight, the reminder rules, and the
weekly review, so "how many open commitments" and "when does a follow-up count from" have
one definition each. Writes go through `apps/orbit/src/features/people/peopleService.ts`.

## Screens

**`/people`** — everyone, alphabetical with the id as tie-breaker, filterable by name, with
counts split into "I owe" and "Owed to me". The badge for many open commitments is the
Week 11 insight for that person (≥ 3 by default), so the list and the Insights page can
never disagree. Deleted people are listed separately with Restore.

**`/people/:id`** — contact details, last contact, and every commitment in both directions
with its status (open, done, dropped), follow-up state, and linked records through the
shared link panel. Opened through insight evidence, a reminder, or `?commitment=<id>`, the
exact commitment is highlighted. A missing or deleted person shows an explicit state; a
deleted person's page shows how many open commitments are hidden and offers Restore.

## Commitments

- Create needs a live person, non-empty text, an explicit direction, and an optional valid
  due date. Due dates are shown as stored; a commitment without one says so.
- Edit changes text, due date, or direction against the fresh record: the fields are
  re-read inside the transaction and validated after the merge, so a stale form cannot
  overwrite another window's change.
- Mark done, Drop, and Reopen are three separate controls. Drop is not a payment and not a
  completed promise; Reopen is explicit and reconciles follow-ups.
- Completing an owed-to-me commitment removes it from follow-up eligibility.
- Nothing completes a commitment because the person replied.

## Record reply/contact

The action label is "Record reply/contact", and the dialog explains before applying:
_Updates last contact for this person and restarts follow-up timing for all open
commitments owed to you. It does not complete any commitment._

- Only `Person.lastContactAt` changes; there is no per-commitment reply field.
- The default timestamp is now; an explicit past time is accepted. A future or unparseable
  time is refused.
- A time older than the stored last contact is reported, not applied; changing it backwards
  is a separate, explicit correction.
- Recording the same time again is a no-op, not a new reminder episode.
- Every open owed-to-me commitment's follow-up restarts through the reminder reconcile in
  the same transaction: if the write fails midway, neither the person nor the queue changes.

## Follow-ups

The quiet period of an owed-to-me commitment counts from the **later** of the commitment's
creation and the person's last recorded contact. A person's old contact date cannot make a
commitment created today overdue, and a reply after the promise restarts the wait. The
calendar-date quiet period and the 09:00 local reminder time from Week 9 are unchanged; a
reply on the same date keeps the same reminder key, and fired or dismissed rows are history
that is never revived, while a cancelled pending row may be.

The Rust scheduler validates the same conditions immediately before delivery: the rule
enabled, the commitment open and owed-to-me, the person live, and no source changed after
the row was prepared. A missing or deleted person cancels delivery outright.

## Deleting and restoring

- Deleting a person is a confirmed soft delete; the confirmation shows how many
  commitments are affected. Their commitments and links stay stored for recovery, are
  hidden from active surfaces, and their follow-ups are cancelled by the reconcile. Nothing
  is transferred to someone else or marked done.
- Restore brings the person back with their still-open commitments and reconciles
  reminders under the normal terminal-key rules.
- Deleting a commitment soft-deletes that commitment only.

## Routes and links

| Reference  | Route                                                                           |
| ---------- | ------------------------------------------------------------------------------- |
| person     | `/people/:id`                                                                   |
| commitment | `/people/:personId?commitment=:id`                                              |
| `orbit://` | `orbit://person/<uuid>`, `orbit://commitment/<uuid>` (see `docs/DEEP-LINKS.md`) |

A commitment link resolves its person from current data; a deleted commitment still lands
on its person, a deleted person is reported missing.

## Limitations

- Contact history is one timestamp per person, not a log of contacts.
- There is no per-commitment reply; "the person replied about this one promise" is
  expressed by marking that commitment done or by recording contact for the person.
- Follow-up reminders exist only for owed-to-me commitments.
