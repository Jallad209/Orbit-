# Notes

A note is a title and a Markdown body that belongs to a project or an area and can link to
other records. The editor is a plain textarea with a lazily loaded, sandboxed preview;
saving is a patch, never a whole record, and "Saved" is only ever shown after the commit.

Service: `apps/orbit/src/features/notes/notesService.ts`; screens: `NotesPage` (`/notes`),
`NotePage` (`/notes/:id`), `NotePreview`; link policy: `markdownLinks.ts`; parent policy:
`resolveNoteParent` in `packages/core/src/services/hierarchy.ts`.

## Screens

`/notes` lists every note, newest edit first with a stable tie-breaker, filterable by
title, area, and project. A new note needs a title (an empty body is fine) and opens
straight into its editor. Deleted notes have an explicit view with Restore; a missing or
deleted id opens an explicit state and never creates a replacement note.

`/notes/:id` is the editor: title, body, preview, project/area assignment, linked records
through the shared link panel, save state, delete/restore. Search snippets and the
read-only `/search?open=note:<id>` preview keep working and offer Open.

## Parent policy

A note belongs to a project (then its area is the project's, never a contradicting one) or
to an area directly. The policy runs on every assignment change:

- assigning a missing, deleted, or archived project is refused;
- a note already inside an archived project keeps its parent and stays editable;
- an imported note whose parent no longer exists shows "Unavailable project"; its body is
  preserved.

Assigning a parent and linking to a project are different operations.

## Saving

- Dirty fields save on blur, on Ctrl+S while the editor has focus, and on the Save button.
- The state is one of Editing, Saving, Saved, Failed, Conflict.
- Every save carries the note id, the base the editor loaded, and only the fields that
  changed. Inside its transaction the current note is re-read and only those fields are
  compared and written — an old complete Note object is never written back.
- Writes are serialized per note. A queued save reads the newest draft and base when it
  runs, and a late response may refresh the base for its own version but never replaces
  text typed after it began.
- A background data refresh never overwrites a dirty draft.
- An empty title fails validation, keeps the draft, and never shows Saved.
- On a storage failure the text stays, the state says Failed, and Retry is offered; there is
  no success toast and no data-changed bump.

## Conflicts

Independent field edits merge (a title changed here and a body changed elsewhere both
land). A change to the same field underneath is a conflict: the editor keeps both the
user's draft and the current saved version and offers reload, copy, or Save as a new
note. Nothing is overwritten silently. A note deleted elsewhere refuses the save and
offers to copy the draft into an explicitly created new note; deleted records are never
resurrected by an edit.

## Preview and link policy

The preview is `react-markdown` with raw HTML dropped (`skipHtml`), no HTML or MDX plugins,
and no `dangerouslySetInnerHTML` path. Headings, lists, emphasis, blockquotes, code, and
ordinary links render; images are never fetched and show their alt text instead; nothing
in a note body causes a network request when it is viewed. The body is stored losslessly
and never rewritten by the preview. The desktop CSP is unchanged.

Links are classified by `classifyHref`:

| Link                                                                                                 | Behaviour                                         |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `http:`, `https:`, `mailto:` (no credentials)                                                        | opens in a new context, only after a click        |
| `orbit://<kind>/<uuid>`                                                                              | through the typed resolver (`docs/DEEP-LINKS.md`) |
| `javascript:`, `data:`, `file:`, UNC, protocol-relative, relative, unknown schemes, encoded bypasses | rendered as plain text                            |

The Markdown exporter is a document generator, not a preview sanitizer, and is not used
here.

## Links

The shared `LinkPicker` loads candidates when it opens, not on every render, shows
loading/error/pending states, and prevents double submission. Both endpoints must be live
inside the same transaction as the link is created; a duplicate link in either direction
with the same type is refused; unlinking soft-deletes the relationship, not the record.
Deleting a note keeps its relationships so a restore can recover them; linked panels
filter missing or deleted endpoints.

## Search

Renaming, editing, or deleting a note refreshes the search index; JSON export and import
keep the body byte-for-byte.

## Limitations

- The editor is a textarea, not a code editor; there is no syntax highlighting or
  structured editing.
- Large bodies are stored and rendered as written; the preview is not virtualized.
- Only acknowledged saves survive a forced termination of the app; an unsaved textarea
  cannot be made transactional (`docs/RESIDENT-BEHAVIOUR.md`).
