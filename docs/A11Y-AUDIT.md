# Accessibility audit

Audit date: 18 September 2026  
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
| Today, Inbox, Timeline                     | PASS              | NOT RUN         | NOT RUN         | NOT RUN          |
| Areas, Goals, Goal detail                  | PASS              | NOT RUN         | NOT RUN         | NOT RUN          |
| Projects, Project detail, Task detail      | PASS              | NOT RUN         | NOT RUN         | NOT RUN          |
| People and Person detail                   | PASS              | NOT RUN         | NOT RUN         | NOT RUN          |
| Spending/Bills and Bill detail             | PASS              | NOT RUN         | NOT RUN         | NOT RUN          |
| Notes and Note detail                      | PASS              | NOT RUN         | NOT RUN         | NOT RUN          |
| Review dashboard, Morning, Evening, Weekly | PASS              | NOT RUN         | NOT RUN         | NOT RUN          |
| Insights, Search, Settings                 | PASS              | NOT RUN         | NOT RUN         | NOT RUN          |

## Manual assistive-technology status

The repository now contains the automated gates and the fixes they found, but a human keyboard
walk, NVDA reading-order/forms pass in the installed WebView2 build, and 200%/400% zoom review
have not yet been performed. They remain **NOT RUN** and are release gates, not implied passes.
VoiceOver is **NOT RUN** because no Apple hardware is available.
