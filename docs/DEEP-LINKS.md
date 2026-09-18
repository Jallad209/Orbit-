# Deep links and destinations

Every record has exactly one address. Search results, linked-record panels, insight
evidence, Markdown links, reminders, palette commands, and native notification clicks all
go through one typed resolver, `apps/orbit/src/lib/destinations.ts`, so a missing record is
never silently redirected to a different one and a link can only ever navigate.

## Canonical routes

| Reference      | Route                                                 |
| -------------- | ----------------------------------------------------- |
| person         | `/people/:id`                                         |
| commitment     | `/people/:personId?commitment=:id`                    |
| bill           | `/bills/:id`                                          |
| note           | `/notes/:id`                                          |
| task           | `/tasks/:id` (a route wrapper around the task editor) |
| project        | `/projects/:id`                                       |
| goal           | `/goals/:id`                                          |
| review         | `/review/weekly?review=:id`                           |
| timeline block | `/timeline?date=YYYY-MM-DD&block=:id`                 |
| area           | `/areas`                                              |
| capture        | `/inbox`                                              |

`/search?open=type:id` previews from Week 10 keep working; detail screens carry the Open
and Edit actions.

## Resolution

`routeFor` maps a fully known reference to its route. References that need current data go
through `resolveDestination` first:

- a **commitment** finds its person; a deleted commitment still lands on its person;
- a **reminder** resolves to its source — a paid bill or a completed commitment opens in
  its historical state;
- a **timeline block** finds its date; a removed block keeps the date with a notice;
- a deleted person, bill, note, task, or review is reported **missing**.

A missing record sends the user to `/missing?type=…&id=…`, a page that explains, never to
another record. Resolving reads; it never writes.

## The `orbit://` contract

`orbit://<kind>/<uuid>` — one scheme, one kind, one UUID segment, an optional trailing
slash, nothing else. Native activation accepts seven kinds: `reminder`, `task`, `person`,
`commitment`, `bill`, `note`, `review`. Input longer than 128 characters is refused before
parsing.

Refused: any other scheme or kind, wrong case, credentials, ports, query strings,
fragments, extra segments, whitespace, any percent-encoding (so encoded separators and
double-decoding tricks never reach a decoder), and unknown actions. Nothing in a URI ever
carries a title, note body, contact text, amount, path, or secret, and only the kind
reaches the logs — never the id.

The parser exists twice, in TypeScript (`parseOrbitUri`) and in Rust
(`apps/orbit/src-tauri/src/activation.rs`), and both are checked against the same 39
vectors in `tests/fixtures/behaviour/orbit-uris.json`: each must accept exactly those and
reject exactly those. One known asymmetry outside the vectors: the TypeScript parser, which
also serves in-app Markdown links, additionally accepts `orbit://project/<uuid>` and
`orbit://goal/<uuid>`; the native parser does not, so those two work as links inside Orbit
but not as notification or protocol activations.

A URI only names a record to open. It cannot mark paid, complete a task, record contact,
import data, accept a plan, run a command, switch the data directory, or open an arbitrary
page. The id is validated as a UUID; the record is looked up in current data at
navigation time.

## Native activation (Windows desktop)

The URI reaches the process by three paths, all handled the same way:

| Path                        | How                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| cold launch                 | a launch argument, from the protocol handler or a notification clicked after Orbit exited |
| running (visible or hidden) | a second launch forwarded through single instance, or the notification's own activation   |
| tray / in-app               | the same resolver, without a URI                                                          |

The shell validates the argument, shows the main window whatever the launch mode, and
holds the activation until the frontend has said the current database generation is ready
**and** the main window's listener is attached; it is deduplicated per delivery (the same
URI within 1.5 s counts once, a later deliberate click counts again) and never creates a
second database owner. Delivery is acknowledged: the queue entry is dropped only after a
successful emit to the same listener subscription; a failed emit or a reloaded renderer
leaves it queued for the next listener.

In the frontend the URI is parsed again, resolved, and navigated to through the draft
guard: a dirty editor asks Save / Discard / Stay first, and reopening the record already on
screen never prompts. During first-run onboarding the destination is held until "Start
planning". See `docs/RESIDENT-BEHAVIOUR.md` for the lifecycle and the verification record.

## Where links are produced

- Search results and `?open=` previews.
- Linked-record panels and the `LinkPicker`.
- Insight evidence rows.
- Markdown `orbit://` links in notes (`docs/NOTES.md`).
- Reminder rows (`orbit://reminder/<id>` as the toast's launch payload).
- Palette commands that open a record.

## Limitations

- The protocol handler is registered by the Windows NSIS installer only; the PWA has no
  `orbit://` handler and receives links as ordinary navigation.
- Installed-build verification of notification clicks with Orbit visible, hidden, and
  exited is still pending. Week 13 supplies `tests/installed/orbit-sandbox.wsb` and its
  checklist, but the candidate has not yet been exercised from an external user terminal —
  see the verification record in `docs/RESIDENT-BEHAVIOUR.md`. The cold-launch path is covered
  by the isolated desktop suite against the real binary.
