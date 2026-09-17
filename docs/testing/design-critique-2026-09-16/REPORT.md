# Orbit — Design and UX critique report

**Date:** 2026-09-16 · **Source:** HEAD `a666f51` (web build, `orbit@0.1.0-alpha.2`, Vite dev
server, Chromium in the Claude desktop browser pane) · **Viewports:** 1440×900 and 700×900.
Report-first: this is a prioritised list of usability, hierarchy, consistency, and accessibility
findings with the evidence behind each one. No application code was changed; nothing was
committed, pushed, or published.

**Scope note.** Orbit is a private app for a selected set of users. Onboarding and first-run
guidance for anonymous web visitors are therefore out of scope and are not reported here.

## 1. Executive summary

The visual system is not the problem. The token set (charcoal rail, warm workspace, lime for
action, gold for importance), Inter with `cv11`/`ss01`, tabular numerals, consistent radii, motion
tokens, reduced-motion handling, the skip link, and the sequence-hotkey scheme are coherent and
well executed. What makes the app _feel_ wrong is that the core loop — capture → triage → plan —
has real defects under fast keyboard use, and several screens combine low-contrast text, unlabeled
controls, and duplicated content so that a good structure reads as undifferentiated beige.

Four findings are rated critical, and all four sit in the Inbox capture/triage flow:

- **UX-001** — the capture input drops focus after every save, so the next keystrokes fire
  single-letter inbox hotkeys. Reproduced: 9 items typed, 6 lost, wrong items accepted.
- **UX-002** — Accept is not idempotent; rapid `Enter` converted one capture six times and filled
  3 h of the day's plan with duplicates.
- **UX-003** — no Undo on any Accept/Archive toast.
- **UX-004** — accepting a goal dead-ends in the _project_ picker with sprint jargon
  ("week 4") in user-facing copy.

The four accessibility failures are token-level and fixable in one file: `ink-faint` at 2.68:1 on
the smallest text, a focus ring at 1.38:1 on the workspace, gold buttons at 3.47:1, and timeline
blocks at ~1.2:1.

### Recommended repair order

1. **UX-001 → UX-004** — fix the capture/triage loop (keep focus, idempotent accept, Undo, area
   picker with inline create). Every other screen depends on this flow working under fast typing.
2. **VH-001 / VH-002 / UX-007** — make Today one column of truth: merge Proposed Plan and the
   Timeline panel, label the energy picker, surface "Why" as text.
3. **A11Y-001 → A11Y-004** — adjust four tokens in `tokens.css` (`ink-faint`, focus ring on light
   surfaces, gold button pairing, timeline block fill).
4. **CN-001 → CN-006** — one date format, two page widths, one create pattern, one save semantic.
5. Remaining moderate/minor items in §3.

## 2. Method

| Step                | What was done                                                                                                            | Evidence                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| Launch              | `pnpm --filter orbit run dev`, opened `/today` at 1440×900                                                               | Empty dashboard, storage banner visible |
| Populate            | Captured 9 items through the Inbox capture bar as a user would (tasks, event, note, goal, bills, `@person`, `p:` prefix) | Inbox grouped list; Today plan          |
| Triage              | Accepted items with `Enter`; observed selection, toasts, and errors                                                      | Duplicate tasks, project picker on goal |
| Structure           | Created 2 areas, 2 projects, 1 task via the UI                                                                           | Areas/Projects/Project pages            |
| Sweep               | Visited Timeline, Goals, Insights, People, Bills, Notes, Weekly review, Morning briefing, Settings, command palette      | Screenshots and `read_page` text dumps  |
| Responsive          | Re-ran Today at 700×900                                                                                                  | Collapsed rail                          |
| Focus check         | `document.activeElement` after a capture save                                                                            | `BODY` (UX-001)                         |
| Contrast            | WCAG 2.x relative-luminance ratios computed from `apps/orbit/src/styles/tokens.css` (script in Appendix A)               | §6 table                                |
| Source verification | Each finding traced to the responsible code path                                                                         | File:line references below              |

One symptom was investigated and **rejected**: `Enter` did not submit the "New area" form. A
capture-phase listener showed a trusted, un-prevented `keydown` reaching `window` with no `submit`
event — the automation was not emitting the `keypress` Chromium needs for implicit submission.
The form is wired correctly (`type="submit"`, `AreasPage.tsx:50–58`). Not an app defect.

## 3. Usability findings

Severity: 🔴 Critical (blocks or corrupts the core loop) · 🟡 Moderate (confuses or slows a
common path) · 🟢 Minor (polish).

| ID         | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                        | Severity | Evidence                                                                                                                                                     | Recommendation                                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UX-001** | **Capture input loses focus after every save.** `CaptureBar.tsx:172` sets `disabled={saving}`, which blurs the input. The refocus in the `finally` block (`CaptureBar.tsx:123`) runs before React re-enables the element, so `.focus()` is a no-op. Subsequent keystrokes land on `<body>` where the Inbox page's single-letter bindings (`InboxPage.tsx:139–147`: `Enter` accept, `e` archive, `t` type, `d` date, `p` project) consume them. | 🔴       | `document.activeElement.tagName === "BODY"` immediately after `Enter`; 9 items typed in sequence → 6 never captured, one item accepted 4× by stray `Enter`s. | Do not disable the input during save — use `readOnly` plus `aria-busy`, or move the refocus into a `useEffect` that runs when `saving` flips back to `false`.                                       |
| **UX-002** | **Accept is not idempotent.** `InboxPage.tsx:101–104` calls `convertCapture` on the selected item; the item remains `selected` until `useRepoQuery` refreshes, so each further `Enter` converts it again.                                                                                                                                                                                                                                      | 🔴       | Today plan and Timeline show "Submit quarterly report" six times (11:00, 11:40, 13:15, 13:55, 14:35, 15:15), 3 h of an 8 h 15 m window.                      | Optimistically remove the capture from the local list (or track a pending-id set) before awaiting; ignore accept while pending.                                                                     |
| **UX-003** | **No Undo.** Accept and Archive toasts (`InboxPage.tsx:104, 116, 132`) are informational only; `toastStore` has no action slot.                                                                                                                                                                                                                                                                                                                | 🔴       | Grep for `undo` in `components/ui/Toast*.tsx` and `InboxPage.tsx`: none.                                                                                     | Add an action to the toast: restore `status: 'inbox'` and delete the created entity. Keyboard-fast triage guarantees mis-hits (see UX-001).                                                         |
| **UX-004** | **Goal accept dead-ends.** A goal needs an area; `InboxPage.tsx:109` maps the `needs-area` error to `setPopover('project')`, so the _project_ picker opens. Its empty state reads "No projects yet. Create one under Projects (week 4)." — internal sprint numbering in user copy. There is no inline create.                                                                                                                                  | 🔴       | Screenshot: "Run a half marathon" selected, project popover open, copy as quoted.                                                                            | Open an area picker for `needs-area`; add a "Create area…" row; remove "(week 4)".                                                                                                                  |
| **UX-005** | **Selection teleports after accept.** `inboxService.ts:73` sorts newest-first; the page displays items grouped by type (`InboxPage.tsx:86–91`); the fallback `items?.[0]?.id` (`InboxPage.tsx:82`) therefore lands on the newest item wherever it sits visually, not the next row.                                                                                                                                                             | 🟡       | Accepting the first _Tasks_ row moved the highlight to a _Bills_ row two groups down.                                                                        | Fall back to the next item in display order (flatten `grouped` and take the neighbour of the removed id).                                                                                           |
| **UX-006** | **"Timeline" means two things.** The Today panel titled _Timeline_ shows the _proposed_ plan (09:00 Buy groceries …). The Timeline page for the same day is empty with "Unscheduled 10".                                                                                                                                                                                                                                                       | 🟡       | Screenshots of `/today` and `/timeline` taken within a minute of each other.                                                                                 | Rename the Today panel ("Proposed day") or render proposals on the real Timeline as ghost blocks with an Accept affordance.                                                                         |
| **UX-007** | **Today shows the same ten rows twice.** Proposed Plan (left) and Timeline (centre) list identical items in identical order. The Plan column — the one with actions — truncates titles ("Review pull reque…", "Send invoice to S…"); the read-only Timeline shows them in full. The Plan header ("PROPOSED PLAN 10 · 5h of 8h 15m free") wraps onto three lines at 1440 px.                                                                    | 🟡       | `/today` at 1440×900.                                                                                                                                        | One column: a timeline with inline `?` / remove. Reclaim the width for At-risk, Projects, Commitments.                                                                                              |
| **UX-008** | **Prefix hint is cryptic and incomplete.** The capture helper reads "Prefixes force a type: t: n: e: g: r: b: c:, @person #project" with no legend. `p:` is not a prefix (projects use `#project`), so "p: Website redesign" was captured as a task titled "P: Website redesign". `@Sarah` matched no person and was silently dropped — no chip, no prompt, no person created.                                                                 | 🟡       | Inbox list and `/people` (empty) after capture.                                                                                                              | Show a legend on focus (`t: task · n: note · e: event · g: goal · r: reminder · b: bill · c: commitment`). When `@name` has no match, offer a "Create Sarah?" chip instead of discarding the token. |
| **UX-009** | **Unlabeled controls.** (a) `Low / Medium / High` segmented control has only `aria-label="Energy"` (`EnergyPicker.tsx:17`); sighted users get no label. (b) The `?` icon on every plan row is the "Why is this in the plan" popover (`WhyPopover.tsx`) — the planner's most persuasive feature, hidden behind mystery meat. (c) The `⌄` area select on the Projects and Goals create forms has no visible label.                               | 🟡       | Screenshots; `read_page` shows `radiogroup "Energy"` with no visible text.                                                                                   | Visible "Energy" label (the morning briefing already has good explanatory copy — reuse it as a tooltip). Show "Why" as a text affordance on row hover/focus. Label the area select.                 |
| **UX-010** | **Storage banner nags on every load.** `store.ts:65` initialises `storageBannerDismissed: false` in memory only; dismissal does not survive reload. Its gold "Export now" competes with the page's primary lime action.                                                                                                                                                                                                                        | 🟡       | Banner present on every navigation after dismiss + reload.                                                                                                   | Persist dismissal (per session or per day); demote "Export now" to a secondary button.                                                                                                              |
| **UX-011** | Goals page has no empty state; Areas, People, Inbox, Insights all do.                                                                                                                                                                                                                                                                                                                                                                          | 🟢       | `/goals` with zero goals shows only the form and blank space.                                                                                                | Reuse the Areas `EmptyState` pattern.                                                                                                                                                               |
| **UX-012** | Bills page: the full multi-field create form is always expanded, followed by two empty "Nothing overdue" / "Nothing due in the next 3 days" cards before the single real bill.                                                                                                                                                                                                                                                                 | 🟢       | `/bills` with one upcoming bill.                                                                                                                             | Collapse the form behind "Add bill"; hide empty sections when another section has content.                                                                                                          |
| **UX-013** | Nav item "Reviews" opens a page titled "Weekly review"; morning and evening flows are reachable only from Today.                                                                                                                                                                                                                                                                                                                               | 🟢       | `NavRail.tsx:41` → `/review/weekly`.                                                                                                                         | Rename the nav entry, or make `/review` a hub listing the three flows.                                                                                                                              |
| **UX-014** | Collapsed rail (< `md`): the `Ctrl K` `<kbd>` hint wraps onto two lines and overlaps the search icon.                                                                                                                                                                                                                                                                                                                                          | 🟢       | `/today` at 700×900.                                                                                                                                         | Hide the kbd below `md` (`CommandPaletteTrigger`).                                                                                                                                                  |
| **UX-015** | A note captured from the Inbox stores the title as the body as well ("Meeting notes from standup" / "Meeting notes from standup").                                                                                                                                                                                                                                                                                                             | 🟢       | `/notes` list.                                                                                                                                               | Leave the body empty on convert.                                                                                                                                                                    |
| **UX-016** | Area rows place the delete (trash) icon immediately beside the weekly-target input with no confirmation.                                                                                                                                                                                                                                                                                                                                       | 🟢       | `/areas`.                                                                                                                                                    | Move delete into an overflow menu or add a confirm step.                                                                                                                                            |

## 4. Visual hierarchy

- **What draws the eye first (Today):** the gold storage banner, then the dark "Proposed next"
  hero. The hero is the correct focal point; the banner should not win (UX-010).
- **Reading flow (Today, 1440 px):** page title → unlabeled energy toggles top-right → hero → two
  free-floating pill buttons ("Start morning briefing" in gold, "Weekly review") → three columns
  of equal-weight cards. The two page-level CTAs have no anchor: they sit between the hero and the
  columns, left-aligned, in a third button style. **(VH-001)** Give them a home — either inside the
  hero as secondary actions or as a row above the columns with a heading.
- **Emphasis:** lime is used for the active nav indicator, Accept, Start, the focus ring, the
  selected energy state, _and_ every timeline block. "Lime = action / now" dilutes into
  "lime = everything". **(VH-002)** Reserve lime for the single primary action per screen and the
  now-line; render timeline blocks in `surface-3` with a lime left edge.
- **Whitespace:** generous and consistent (`px-10 py-8`). At 700 px the single-column Today reads
  _better_ than the 1440 px three-column layout — the desktop layout spreads content rather than
  prioritising it (UX-007).
- **Cards on surface:** `surface-2` on `surface` with `line` borders at 1.36:1 (§6). Combined with
  `ink-faint` labels this is what produces the "beige on beige" impression. A slightly darker
  `line` (≈ `#c9c0ae`, 1.7:1) keeps the softness while separating panels.

## 5. Consistency

| ID         | Element        | Issue                                                                                                                                                                                                            | Recommendation                                                                             |
| ---------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **CN-001** | Dates          | "Fri 25 Sep" (Inbox), "2026-09-20" (Bills, Notes), "(2026-09-14 → planning 2026-09-21)" inside the Weekly review CTA.                                                                                            | One human format everywhere; ISO only in `<time datetime>`.                                |
| **CN-002** | Page width     | Today full-bleed; Inbox/Projects/Goals/Areas/People ≈ 860 px centred; Insights ≈ 1000 px; Settings another width.                                                                                                | Two widths: a "workspace" width (Today, Timeline) and a "reading" width (everything else). |
| **CN-003** | Create pattern | Single-line inline form (Areas, Goals, Notes, People, Projects) vs. always-open multi-field form (Bills) vs. capture bar (Inbox).                                                                                | Inline one-liner everywhere with a "more fields" disclosure.                               |
| **CN-004** | Save semantics | Notes: "saved as you go". Settings: explicit "Save planning settings".                                                                                                                                           | Auto-save with a "Saved" indicator, or explicit save everywhere.                           |
| **CN-005** | Toast wording  | "Captured as task" fires on _Accept_ (`InboxPage.tsx:104`); the item was captured earlier.                                                                                                                       | "Added task" / "Archived".                                                                 |
| **CN-006** | Empty states   | Present on Areas, People, Inbox, Insights; absent on Goals (UX-011). Insights' empty copy is engineering-flavoured ("Estimate bias needs 5 completed tasks with an estimate and a recorded actual in one area"). | Shared `EmptyState` component; rewrite Insights reasons in user terms.                     |
| **CN-007** | Button styles  | Lime primary, secondary, gold, ghost, and a gold _pill_ ("Start morning briefing") that appears nowhere else.                                                                                                    | Fold the pill into the `gold` variant.                                                     |

## 6. Accessibility

Ratios computed from `apps/orbit/src/styles/tokens.css` (Appendix A). WCAG 2.1 AA: 4.5:1 body
text, 3:1 large text and UI components (1.4.11), 3:1 focus indicators (2.4.11 / 2.4.13).

| ID           | Pair                                                                           | Ratio    | Result | Where it appears                                                                                                         |
| ------------ | ------------------------------------------------------------------------------ | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| —            | `ink` #1a1917 on `surface` #f5f1ea                                             | 15.60    | ✅     | body text                                                                                                                |
| —            | `ink-muted` #6b665d on `surface`                                               | 5.06     | ✅     | subtitles                                                                                                                |
| —            | `ink-muted` on `surface-2` #ede7dd                                             | 4.64     | ✅     | card body                                                                                                                |
| —            | `nav-fg` #ece7dd on `nav` #1c1b1a                                              | 13.96    | ✅     | rail labels                                                                                                              |
| —            | `nav-muted` #9c968b on `nav`                                                   | 5.85     | ✅     | rail inactive                                                                                                            |
| —            | `lime-ink` #1e2a00 on `lime` #c6f135                                           | 11.57    | ✅     | primary buttons                                                                                                          |
| —            | `gold-ink` #6b4f0a on `gold-2` #e9c96a                                         | 4.74     | ✅     | banner text                                                                                                              |
| —            | `danger` #c43d2e on `surface`                                                  | 4.60     | ✅     | error text                                                                                                               |
| **A11Y-001** | **`ink-faint` #9a9488 on `surface`**                                           | **2.68** | ❌     | 11–12 px capture hints, section labels, `<kbd>` hints, project subtitles — the _smallest_ text uses the _weakest_ colour |
| **A11Y-001** | `ink-faint` on `surface-2`                                                     | 2.45     | ❌     | card metadata                                                                                                            |
| **A11Y-002** | **Focus ring `lime-2` #b3df1f on `surface`**                                   | **1.38** | ❌     | `:focus-visible` outline on every control in the workspace (`tokens.css` `@layer base`). Fine on the dark rail.          |
| **A11Y-003** | **`gold-ink` on `gold` #d4a93a** (Button `gold` variant, 13 px)                | **3.47** | ❌     | "Start morning briefing", "Export now"                                                                                   |
| **A11Y-004** | **Timeline task block `bg-lime/30` on `surface-2`** (`CompactTimeline.tsx:15`) | ≈ 1.2    | ❌     | blocks barely separate from the track                                                                                    |
| —            | `nav-muted/70` on `nav` (rail kbd hints)                                       | 3.21     | ⚠      | passes only as UI/large text; the hints are 11 px                                                                        |
| —            | `ok` #3d8f5a on `surface`                                                      | 3.54     | ⚠      | passes for icons/large text only                                                                                         |
| —            | `line` #d8d0c1 on `surface`                                                    | 1.36     | ⚠      | borders are decorative, so not a hard failure, but see §4                                                                |

Fixes (all in `tokens.css` / `Button.tsx`):

- **A11Y-001** — `--color-ink-faint: #7d776b` (≈ 4.6:1 on `surface`).
- **A11Y-002** — outline colour `var(--color-ink)` or `var(--color-ok)` on light surfaces; keep
  `lime-2` inside `.bg-nav`.
- **A11Y-003** — `gold: 'bg-gold-2 text-gold-ink'` (4.74:1), or darken `gold-ink`.
- **A11Y-004** — `bg-surface-3 border-l-2 border-lime-2` for task blocks.

Other checks:

- **Touch / pointer targets:** nav rows 36 px, buttons 32–44 px — adequate for desktop. Icon
  buttons (`?`, `×`, trash) ≈ 28 px — tight for touch.
- **Text readability:** body 15 px / 24 px is good. Too much UI sits at 11–12 px in `ink-faint`.
- **Semantics present and correct:** skip link, `aria-label` on inputs and the radiogroup,
  `role="radio"` with `aria-checked`, progress bars labelled, `prefers-reduced-motion` and the
  in-app reduce-motion switch both honoured. Project list rows are real `<Link>`s.
- **Missing visible labels:** energy picker, area selects (UX-009).

## 7. What works well

- **Live parse preview** in the capture bar — "Task · Fri 25 Sep" appears before commit, `Tab`
  cycles alternatives, tokens are removable chips. Best-in-class for this category.
- **"Why is this in the plan"** — plain-language reasons plus the score components
  (`WhyPopover.tsx`). A transparent planner is rare; this deserves to be visible (UX-009b).
- **Proposed Next hero** with Start / Done — one unambiguous focus per day.
- **Morning briefing wizard** — four clean steps (Energy → At risk → Plan → Accept) with the best
  copy in the app ("Low leaves demanding work out; high lets it in").
- **Command palette** — grouped commands, visible sequence hotkeys, type filters.
- **Project detail page** — status, deadline, goal, next action, desired outcome, milestones,
  tasks, linked records: complete and well ordered.
- **Token system** — a small, named palette; Inter with stylistic sets; tabular numerals for
  times and amounts; one radius scale; motion tokens with reduced-motion overrides.

## 8. Priority recommendations

1. **Fix the capture → triage loop (UX-001 → UX-005).** Keep focus in the input after save, make
   accept idempotent, add Undo to toasts, route `needs-area` to an area picker with inline create,
   and advance selection in display order. This is the "Capture" in Capture → Plan → Do → Review;
   nothing downstream is trustworthy while fast typing corrupts it.
2. **Make Today one column of truth (UX-006, UX-007, UX-009, VH-001, VH-002).** Merge Proposed
   Plan and the Timeline panel into a single timeline with inline actions; label the energy
   picker; surface "Why" as text; anchor the two page-level CTAs. This removes the double-read,
   stops title truncation, and frees width for At-risk / Projects / Commitments.
3. **Fix the four contrast tokens (A11Y-001 → A11Y-004).** One-line changes in `tokens.css`
   and `Button.tsx` that lift every screen: darken `ink-faint`, use a dark focus ring on light
   surfaces, move gold buttons to `gold-2`, and give timeline blocks a real fill.
4. **Consolidate conventions (CN-001 → CN-007).** One date format, two page widths, one create
   pattern, one save semantic, one toast vocabulary, one empty-state component.

## Appendix A — contrast script

```js
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const L = (h) => {
  const [r, g, b] = hex(h).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const cr = (a, b) => {
  const x = L(a),
    y = L(b);
  return ((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2);
};
// e.g. cr('#9a9488', '#f5f1ea') → 2.68
```

## Appendix B — files referenced

| File                                                | Lines                                  | Finding                                |
| --------------------------------------------------- | -------------------------------------- | -------------------------------------- |
| `apps/orbit/src/features/inbox/CaptureBar.tsx`      | 112–125, 172                           | UX-001                                 |
| `apps/orbit/src/features/inbox/InboxPage.tsx`       | 82, 86–91, 101–116, 132, 139–147       | UX-002, UX-003, UX-004, UX-005, CN-005 |
| `apps/orbit/src/features/inbox/inboxService.ts`     | 71–74                                  | UX-005                                 |
| `apps/orbit/src/features/today/EnergyPicker.tsx`    | 17                                     | UX-009                                 |
| `apps/orbit/src/features/today/WhyPopover.tsx`      | 20–24                                  | UX-009                                 |
| `apps/orbit/src/features/today/CompactTimeline.tsx` | 15                                     | A11Y-004                               |
| `apps/orbit/src/components/StorageBanner.tsx`       | 26–28, 41, 67                          | UX-010                                 |
| `apps/orbit/src/app/store.ts`                       | 65, 76                                 | UX-010                                 |
| `apps/orbit/src/components/layout/NavRail.tsx`      | 41                                     | UX-013                                 |
| `apps/orbit/src/components/ui/Button.tsx`           | 16, 20                                 | A11Y-003, CN-007                       |
| `apps/orbit/src/styles/tokens.css`                  | `@theme`, `@layer base :focus-visible` | A11Y-001, A11Y-002, §4                 |
