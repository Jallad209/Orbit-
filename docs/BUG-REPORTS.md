# Reporting a bug

Orbit has no telemetry. Nothing about how you use it leaves your machine unless you decide
to attach a file to a report. This page says what that file holds, what it never holds, and
how to read it before you share it.

## What to send

1. **What you did, what you expected, what happened.** Three sentences are enough; the exact
   sequence matters more than the wording.
2. **The version.** Settings → Data → Diagnostics shows it; it is also the first line of the
   bundle's `report.json` (`app.version`) and the installer's file name.
3. **The diagnostics bundle**, if the problem is anything other than a typo: Settings → Data →
   **Save diagnostics bundle**. On desktop this writes a `.zip` where you choose; on the web it
   downloads a `.json`. Open it and read it (see below), then attach it to the issue.

Issues go to the repository's issue tracker. If you would rather not post a bundle publicly,
say so in the issue and it can be sent privately.

## What the bundle contains

`report.json` (both runtimes):

| Section   | What it is                                                                           |
| --------- | ------------------------------------------------------------------------------------ |
| `app`     | Orbit's version and whether this is the web or desktop build                         |
| `runtime` | Capabilities, browser family and major version, OS family, language, time zone       |
| `schema`  | Export, IndexedDB, and SQLite schema versions                                        |
| `storage` | Whether the browser granted persistent storage, and usage/quota numbers              |
| `data`    | **Row counts** per store (live and total), nothing else                              |
| `search`  | Which search backend answered (`minisearch` or `fts5`)                               |
| `desktop` | Whether the integrity check passed, how many messages it produced, FTS5 availability |
| `lastRun` | Whether the previous run closed cleanly, and a crash location if it panicked         |
| `events`  | The last 500 error events (see below)                                                |
| `shell`   | Desktop only: shell version, Tauri version, OS and architecture                      |

An **event** is: a timestamp, a level, where it came from (`console`, `window`, `promise`, or
`app`), the error class or operation name (`TypeError`, `data-file:open`), the route with ids
replaced (`/projects/:id`), the script path and line/column when the browser reported one, an
8-character digest of the message so repeats can be grouped, and small numbers or flags
(durations, counts). The message text itself is never kept.

Desktop bundles also carry:

- `logs/orbit-<date>.<n>.log` — the rolling log, one JSON object per line: timestamp, level,
  subsystem (`db`, `data`, `scheduler`, `process`, `webview`, `diagnostics`, `resident`,
  `prefs`, `autostart`), operation, and
  fields. A new file starts each day and whenever one reaches 10 MB; the seven newest are kept.
- `last-run.json` — when the previous run started, whether it ended cleanly, and the panic
  record if it did not.

## What the bundle never contains

- Task, project, goal, note, routine, bill, or commitment **titles, bodies, or text**.
- People's **names or contact details**.
- **Search queries** or command arguments.
- **SQL parameters** or record ids.
- File **paths** (the data folder, backups, or the bundle itself).
- The raw user-agent string, or anything about other applications.

The log writer enforces this rather than relying on care: every string that reaches it has
quoted segments replaced by `…` and is cut to 80 characters (an error such as
`no such column: "Buy milk"` is stored as `no such column: "…"`); nested values are dropped;
the panic hook stores a redacted message of at most 200 characters. The web side stores only
error classes and digests. The test suites contain records with marker strings and prove that
none of them appear in a report or a bundle.

## Read it before you share it

Open the zip (or the JSON) and look through it. It is small and plain text. If anything in it
looks like something you wrote, do not send it — open an issue describing where it appeared;
that is itself a bug, and the redaction rules above will be fixed.

## When Orbit did not close cleanly

The desktop shell writes a marker at startup and clears it on a clean exit. If the marker is
still set the next time Orbit opens, a notice says so once; the data file was integrity-checked
at startup regardless. If it happens again, save a bundle right after restarting: the log and
the crash record from the previous run are still in it.
