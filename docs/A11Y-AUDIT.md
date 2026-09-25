# Accessibility audit

Audit date: 18 September 2026; keyboard and zoom walked 25 September 2026  
Code baseline: `19888d239a355e55489174768d80e114545f42ad` plus the uncommitted Week 13 implementation  
Target: WCAG 2.1 AA for Orbit's narrow-desktop and desktop interfaces

## Automated results

The Playwright axe audit seeds real records and scans every static route plus goal, project,
task, person, bill, and note detail pages. It fails on any serious or critical violation.

| Check                 | Result | Evidence                                                                                                |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| Chromium route audit  | PASS   | Cross-browser audit — 1 passed                                                                          |
| Firefox route audit   | PASS   | Cross-browser audit — 1 passed                                                                          |
| WebKit route audit    | PASS   | Cross-browser audit — 1 passed                                                                          |
| Token contrast matrix | PASS   | `tokens.test.ts` checks the text/background pairs used by the UI                                        |
| Reduced motion        | PASS   | CSS disables transitions for both OS preference and the in-app setting; Toast combines both preferences |
| Narrow desktop        | PASS   | Component tests assert the 768 px rail and 900 px Today breakpoints; desktop minimum is 720 × 560       |

The audit found and fixed three issues: active-rail shortcut contrast, opacity-reduced storage
banner text, and a timeline scroll region that Safari keyboard users could not focus. It also
replaced the project task list's nested listbox/checkbox/button semantics with an ordinary list
whose controls are independently focusable.

## Route record

All rows below passed the Chromium, Firefox, and WebKit axe scans with zero serious or critical
findings. “Detail” means the scan used a real record created through the product UI.

| Route group                                | Three-browser axe | Keyboard manual | NVDA / WebView2 | Zoom 200% / 400% |
| ------------------------------------------ | ----------------- | --------------- | --------------- | ---------------- |
| Today, Inbox, Timeline                     | PASS              | PASS            | NOT RUN         | PASS             |
| Areas, Goals, Goal detail                  | PASS              | PASS            | NOT RUN         | PASS             |
| Projects, Project detail, Task detail      | PASS              | PASS            | NOT RUN         | PASS             |
| People and Person detail                   | PASS              | PASS            | NOT RUN         | PASS             |
| Spending/Bills and Bill detail             | PASS              | PASS            | NOT RUN         | PASS             |
| Notes and Note detail                      | PASS              | PASS            | NOT RUN         | PASS             |
| Review dashboard, Morning, Evening, Weekly | PASS              | PASS            | NOT RUN         | PASS             |
| Insights, Search, Settings                 | PASS              | PASS            | NOT RUN         | PASS             |

## Manual assistive-technology status

The keyboard and zoom columns were walked on 25 September 2026 against the dev build in Chromium
with a seeded database (248 records), at 1280 × 900 and at the two zoom widths. NVDA remains
**NOT RUN**: it has to be read in the installed WebView2 build rather than a browser, and it is a
release gate, not an implied pass. VoiceOver is **NOT RUN** because no Apple hardware is available.

### Keyboard, 25 September 2026

Driven with real Tab keypresses, not scripted `focus()` — the latter never triggers
`:focus-visible` and makes every control look unstyled.

| Check                                                     | Result                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Visible focus indicator on every stop (2.4.7)             | PASS — 85 consecutive stops across Today and Settings, each a 2 px solid outline |
| Focus order follows the visual layout (2.4.3)             | PASS — rail, then banner, then section nav, then panel; no positive `tabindex`   |
| Every control has an accessible name (4.1.2)              | PASS — 671 tabbable elements over 22 routes, none unnamed                        |
| Skip link is the first stop                               | PASS — "Skip to content"                                                         |
| Command palette traps focus, Escape closes, focus returns | PASS in steady state; see the first-open race below                              |
| No keyboard trap (2.1.2)                                  | PASS — no stop refused to release focus                                          |

**Known issue, low severity, not fixed for 1.0.** The palette dialog is lazy-loaded, so on the
first `Ctrl+K` of a page load an Escape pressed before the chunk arrives is either swallowed (the
palette opens a moment later) or leaves focus on `<body>` instead of the control that opened it.
Every later open restores focus correctly, and about half a second is enough on the first one.
The fix is to preload the chunk or hold Escape until the dialog mounts; neither is worth touching
the palette for this close to the release.

### Zoom 200% / 400%, 25 September 2026

Measured as reflow at 640 and 320 CSS px (400% of a 1280 px window is 320 px), looking for a
horizontal scrollbar, elements spilling past the viewport, and text crushed into a column too
narrow to read.

| Width         | Result                                                               |
| ------------- | -------------------------------------------------------------------- |
| 640 px (200%) | PASS — no horizontal scrolling and no overflow on all 22 routes      |
| 320 px (400%) | PASS after the fixes below — no horizontal scrolling and no overflow |

At 400% the audit found four places where a `flex-wrap` row never wrapped: the text column used
`flex-1`, whose zero basis lets it shrink indefinitely, while a badge or button beside it kept
its width. Worst cases were the storage banner's sentence in a 58 px column 20 lines tall,
pushing the page heading 569 px down a 900 px viewport, and insight text in a 9 px column. Each
text column now carries a minimum width so the row wraps instead: `StorageBanner`,
`ExportReminder`, `InsightCard`, `InsightHistory`, `ReviewDashboard`, and the shared `Toggle`.
