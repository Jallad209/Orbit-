# Frontend Team Tasks (13 Weeks)

**Tech Stack:** React 18 + Vite + TypeScript + Tailwind CSS + Radix UI Primitives + Framer Motion + Zustand + Vite PWA + Tauri 2 API (from week 7) + Vitest + Testing Library
**Repository:** `C:\Orbit`
**Packages Owned:** `apps/orbit/src`
**Current Status:** Weeks 1-9 ✅ COMPLETE

> The frontend talks only to `@orbit/core` services, the `Repository` interface, and a `Platform` interface. It never issues SQL, never imports Tauri APIs outside `src/platform/`, and never calls the network. All fonts and assets are bundled. Weeks 1–6 run in a plain browser; the desktop shell is integrated in week 7.

---

## Week 1: Vite + React Setup, Design Tokens & App Shell ✅ COMPLETE

**Description:** This week establishes the application shell as a web app. You will scaffold Vite with React 18 and strict TypeScript, configure Tailwind with the Orbit design tokens (charcoal navigation, warm neutral workspace, lime and gold accents), bundle the Inter variable font, define the `Platform` interface with its web implementation, and build the application frame: a dark navigation rail, a workspace area, routing for every screen in the spec, and the global keyboard focus system that all later screens rely on.

### Research Required:

- **Vite + React + TypeScript:** Strict config, path aliases, workspace package linking
- **Design Tokens in Tailwind:** CSS custom properties → Tailwind theme, semantic color names (`bg-surface`, `text-ink`, `bg-lime`)
- **Bundled Fonts:** `@font-face` with local files, `font-display`, variable font axes
- **Platform Abstraction:** Interface for storage factory, notifications, file dialogs, hotkeys, tray; capability flags
- **Keyboard-First Apps:** Roving tabindex, focus rings, `useHotkeys` patterns, avoiding conflicts with the browser
- **React Router v6:** Nested layouts, route objects, lazy routes

### Setup Tasks:

1. **Vite + React + TypeScript** — Scaffold `apps/orbit`, strict tsconfig, `@/` alias, `@orbit/core` and `@orbit/storage` linked
2. **Design Tokens** — `tokens.css` (nav, surface, surface-2, ink, lime, gold, danger, spacing, radii, motion), Tailwind theme extension
3. **Typography** — Inter Variable bundled, type scale from spec §9, tabular numerals for times
4. **Platform Interface** — `src/platform/{types,web}.ts`; `platform.capabilities` (`backgroundReminders`, `dataFolder`, `globalHotkey`, `tray`)
5. **App Shell** — `AppLayout` with charcoal nav rail (Today, Inbox, Timeline, Projects, Goals, Areas, People, Bills, Notes, Reviews, Settings), workspace outlet
6. **Routing** — All routes from spec §8 as placeholders
7. **Keyboard System** — Global hotkey registry, `g t` / `g i` style navigation, visible focus styles

### Unit Tests Required:

- **Component Tests:**
  - AppLayout renders nav with all destinations
  - Active route highlighted
  - Focus ring visible on keyboard navigation (class assertion)
- **Platform Tests:**
  - Web platform reports `backgroundReminders: false`, `dataFolder: false`
- **Hotkey Tests:**
  - `g t` navigates to /today
  - Hotkeys ignored while typing in an input

**What was done:**

- Vite 8 + React 19 + strict TypeScript in `apps/orbit`, `@/` alias, workspace packages linked
- Tailwind v4 with the Orbit palette declared as `@theme` tokens in `tokens.css` (no `tailwind.config.ts` needed in v4): nav, surface, ink, lime, gold, danger, type scale, radii, motion
- Inter Variable bundled from `@fontsource-variable/inter`; no network fonts
- `Platform` interface with capability flags; `webPlatform` reports `backgroundReminders: false`, `dataFolder: false`; `PlatformProvider` opens the repository once and exposes `usePlatform()` / `useRepository()`
- `AppLayout` with charcoal `NavRail` (11 destinations, lime active indicator, collapses to icons under `md`), skip link, `main` landmark
- All spec §8 routes registered with `Placeholder` pages; `/` redirects to `/today`
- `HotkeyRegistry` supporting single keys, chords (`mod+k`), and sequences (`g t`, 800 ms window); ignores text fields; later registrations override; `useHotkey` hook reads the registry from `HotkeyProvider` context; `formatHotkey` for labels
- Visible lime focus ring on every focusable element; reduced-motion respected
- 22 app tests: layout, active route, redirect, skip link, keyboard navigation via `g` sequences, focus ring, registry behaviour, platform capabilities

**Files created:**

- `apps/orbit/{package.json,tsconfig.json,vite.config.ts,index.html}` ✅
- `apps/orbit/src/{main.tsx,App.tsx,routes.tsx}` ✅
- `apps/orbit/src/styles/tokens.css` ✅
- `apps/orbit/src/platform/{types.ts,web.ts,index.tsx,platform.test.tsx}` ✅
- `apps/orbit/src/components/layout/{AppLayout.tsx,NavRail.tsx,AppLayout.test.tsx}` ✅
- `apps/orbit/src/lib/{hotkeys.ts,hotkeys.test.ts,HotkeyProvider.tsx,cn.ts}` ✅
- `apps/orbit/src/pages/Placeholder.tsx` ✅
- `apps/orbit/src/test/{setup.ts,render.tsx}` ✅

**Deliverables:**

- [x] `apps/orbit/src/{main.tsx,App.tsx,routes.tsx}`
- [x] `apps/orbit/src/styles/tokens.css` (Tailwind v4 `@theme`; replaces `tailwind.config.ts`)
- [x] `apps/orbit/src/platform/{types,web}.ts`
- [x] `apps/orbit/src/components/layout/{AppLayout,NavRail}.tsx`
- [x] `apps/orbit/src/lib/hotkeys.ts`
- [x] Unit tests written and passing

**Verification:**

```bash
pnpm install
pnpm run dev
pnpm run type-check
pnpm vitest run --project orbit
```

---

## Week 2: Base Component Library & PWA Shell ✅ COMPLETE

**Description:** This week you will build the reusable component set every screen uses and make the app installable. Components wrap Radix primitives for accessibility, take their look from the design tokens, and include motion tokens for immediate interaction feedback. The PWA manifest and service worker make Orbit installable and fully offline in the browser from this week on.

### Research Required:

- **Radix Primitives:** Dialog, Popover, DropdownMenu, Tooltip, Checkbox, Toggle, Tabs, ScrollArea
- **Framer Motion:** Layout animations, `AnimatePresence`, reduced-motion respect
- **Accessible Contrast:** Lime background requires dark text; gold on warm neutral needs a darker gold for text
- **Component API Design:** Variants via `class-variance-authority`, polymorphic `as` where needed
- **Vite PWA Plugin:** Workbox precache, offline fallback, manifest, update prompt

### Component Tasks:

1. **Primitives** — Button (primary lime / secondary / ghost / danger), Input, Textarea, Select, Checkbox, Toggle, Kbd
2. **Overlays** — Dialog, Popover, DropdownMenu, Tooltip, Toast
3. **Data Display** — Card, Badge (type chips: task/event/note/goal/routine/bill/person), ProgressBar, EmptyState, Skeleton
4. **Lists** — `ListRow` with keyboard selection, `SectionHeader`, `InlineEdit`
5. **Motion Tokens** — `fast` 120ms, `base` 180ms, reduced-motion guard
6. **PWA Shell** — Manifest, icons, service worker precaching, "offline ready" toast, persistent-storage request on first run
7. **Demo Route** — `/dev/components` (dev only) showing every variant and state

### Unit Tests Required:

- Button variants render correct classes; disabled blocks click
- Dialog traps focus and closes on Escape
- Type Badge renders the correct label/color for each entity type
- InlineEdit commits on Enter, cancels on Escape
- Toast auto-dismisses and is announced via `aria-live`
- Storage status banner appears when persistence is denied

**What was done:**

- 21 components in `components/ui`: Button (5 variants, 5 sizes, loading), Input, Textarea, Select (native, styled), Label, FieldError, Checkbox and Toggle (Radix), Kbd, Dialog (Radix, focus trap, Escape, close button), Popover, Tooltip, DropdownMenu (items, checkbox/radio items, labels, separators), Toast + `toast()` store (zustand, polite live region, auto-dismiss, sticky with action, id replacement, stack cap), Card, SectionHeader, ProgressBar, EmptyState, Skeleton, Badge + TypeBadge (8 entity kinds), List + ListRow (listbox semantics, j/k/arrows/Home/End/Enter), InlineEdit (Enter commits, Escape cancels, blur commits, empty rejected)
- Radix via the `radix-ui` umbrella package; Motion (`motion/react`) for the toast stack with reduced-motion respected; CSS keyframe tokens (`--animate-*`) for overlays
- `styles/motion.ts` exposes durations, easing, and variants mirroring the CSS tokens
- PWA shell via `vite-plugin-pwa`: manifest (name, lime/charcoal colours, standalone, `/today` start URL), generated PNG icons (192, 512, maskable, apple-touch) from `scripts/make-icons.mjs` (pure JS, no downloads), precache of the whole bundle including fonts, `registerType: prompt`
- `usePwa` hook raises "works offline now" and a sticky "new version ready → Reload" toast
- `StorageBanner` requests persistent storage on web and warns when refused; hidden on desktop by capability flag; `useAppStore` (zustand) holds storage status and PWA flags
- `webPlatform.createRepository()` now opens IndexedDB through the storage factory, with an in-memory fallback when IndexedDB is unavailable
- Dev-only `/dev/components` gallery, lazy-loaded and excluded from production
- Build gate: 156 tests, coverage thresholds enforced (core 90 / storage 85 / app 70), lint, format, type-check, and a PWA production build

**Files created:**

- `apps/orbit/src/components/ui/{Button,Input,Checkbox,Kbd,Dialog,Popover,DropdownMenu,Toast,toastStore,Card,Badge,List,InlineEdit,index}.tsx|ts` ✅
- `apps/orbit/src/components/ui/{Button,Dialog,Badge,InlineEdit,Toast,List}.test.tsx` ✅
- `apps/orbit/src/components/{StorageBanner.tsx,StorageBanner.test.tsx}` ✅
- `apps/orbit/src/styles/motion.ts`, animation tokens in `tokens.css` ✅
- `apps/orbit/src/app/store.ts`, `apps/orbit/src/pwa/usePwa.ts`, `apps/orbit/src/vite-env.d.ts` ✅
- `apps/orbit/public/icon.svg`, `apps/orbit/public/icons/*.png`, `scripts/make-icons.mjs` ✅
- `apps/orbit/src/pages/dev/ComponentsGallery.tsx` ✅
- `apps/orbit/vite.config.ts` (PWA manifest + workbox) ✅

**Deliverables:**

- [x] `apps/orbit/src/components/ui/*` (≥ 18 components)
- [x] `apps/orbit/src/styles/motion.ts`
- [x] `apps/orbit/public/manifest.webmanifest`, service worker config (generated by vite-plugin-pwa at build)
- [ ] `/dev/components` demo route
- [ ] Unit tests written and passing

**Verification:**

```bash
pnpm run build && pnpm run preview
# Install as PWA; go offline; reload; app loads. Visit /dev/components with the mouse unplugged
```

---

## Week 3: Universal Inbox ✅ COMPLETE

**Description:** This week you will build capture and triage. The capture bar accepts natural language, shows the parser's guessed type as a chip with a confidence hint, and lets the user cycle types with Tab or click an alternative. Captured items land in the inbox list where they can be triaged (assign project/area, set date, convert type, archive) entirely from the keyboard. Capture must feel instant and never block. An in-app quick-capture overlay opens from any screen; the system-wide version arrives with the desktop shell in week 7.

### Research Required:

- **Optimistic UI:** Insert locally then persist; rollback on failure
- **Parser Feedback UX:** Showing extracted fields inline (date, person, amount) as removable tokens
- **Keyboard Triage:** Single-key actions (`p` project, `d` date, `t` type, `e` archive), `j/k` navigation
- **Overlay Capture:** Focus management for an overlay that opens from any screen

### Page Tasks:

1. **CaptureBar Component** — Input, live classification chip, extracted-field tokens, Tab cycles type, Enter saves
2. **Inbox Page** — List of unprocessed items grouped by type, `j/k` navigation, selection
3. **Triage Actions** — Assign project (searchable popover), set due date (date popover), change type, archive, open
4. **Quick Capture Overlay** — In-app shortcut (`c`) opens the capture bar as an overlay from any screen
5. **Empty & Error States** — Inbox zero state; parser failure shows "saved as note" with a correction chip

### Unit Tests Required:

- **Component Tests:**
  - Typing "Submit my report next Friday" shows Task chip and a date token
  - Tab cycles through alternatives in order
  - Enter saves and clears the bar
  - Inbox groups by type and supports `j/k`
- **Interaction Tests:**
  - `p` opens project assignment; selecting moves item out of inbox
  - Archive removes the row with animation
  - `c` opens the overlay and focuses the input
- **Integration Tests:**
  - Capture writes through the repository (in-memory) and appears in the list

**What was done:**

- `CaptureBar`: parses on every keystroke with the repository's people and project names as context, shows the guessed type as a `TypeBadge` (with a "guess" hint under 60 % confidence) and every extracted span as a removable chip; Tab / Shift+Tab cycle the ranked alternatives via `reclassify`; Enter saves a `Capture` and clears; Escape clears
- `InboxPage`: captures grouped by type in one keyboard list (j / k / arrows / Home / End across groups), newest first; selection falls back to the first item when the chosen one leaves; `TriageActions` toolbar with type menu, date popover (today / tomorrow / in a week / custom / clear), searchable project popover, Accept, Archive
- Single-key hotkeys `t` cycle type, `d` date, `p` project, `e` archive, Enter accept, all ignored while typing; assigning a project converts the capture into a task (or note) in that project
- `inboxService`: save, list, set type, set date, archive, and `convertCapture`, which writes the materialised records and marks the capture processed in one transaction; `MaterializeError` codes surface as toasts
- `QuickCaptureOverlay` on `c` from any screen, mounted in the app layout; closes on save with an "Open inbox" toast action
- `useRepoQuery` + `bumpData()` in `data/useQuery.ts`: the read model for the whole app until live queries arrive
- Hotkey fixes found by the inbox tests: `useHotkey` now calls the latest handler through a ref, and a pending sequence like `g` can no longer be stolen by a page's single-key binding
- Empty state "Inbox zero"; 13 new tests covering chips, Tab cycling, save and clear, token removal, grouping, j/k, p → project, e, Enter, t, live insert, overlay open/close, overlay ignored while typing

**Files created:**

- `apps/orbit/src/features/inbox/{CaptureBar.tsx,InboxPage.tsx,TriageActions.tsx,QuickCaptureOverlay.tsx,inboxService.ts}` ✅
- `apps/orbit/src/features/inbox/{CaptureBar.test.tsx,InboxPage.test.tsx}` ✅
- `apps/orbit/src/data/useQuery.ts`, `apps/orbit/src/app/store.ts` (dataVersion, quick capture) ✅
- `apps/orbit/src/lib/hotkeys.ts` (ref-based handler, sequence isolation), `components/ui/Badge.tsx` (commitment kind) ✅

**Deliverables:**

- [x] `apps/orbit/src/features/inbox/{CaptureBar,InboxPage,TriageActions,QuickCaptureOverlay}.tsx`
- [x] Unit tests written and passing

**Verification:**

```bash
pnpm run dev
# Capture the four example phrases from the spec; correct one with Tab
```

---

## Week 4: Areas, Goals, Projects & Tasks ✅ COMPLETE

**Description:** This week you will build the structure screens that make Orbit one connected system. Areas, goals, and projects each get a list and a detail view. The project detail shows outcome, deadline, milestones with progress, the next action, and linked notes, people, events, and bills. Tasks can be created, edited inline, moved between projects, and given dependencies. Neglected goals and projects without a next action are visibly flagged.

### Research Required:

- **Master-Detail Layouts:** Resizable panes, keeping list position on navigation
- **Linking UI:** Universal "link to…" picker with type filter and fuzzy search
- **Inline Editing Patterns:** Milestone reorder via keyboard, estimate input with unit parsing (`1h30`)
- **Health Indicators:** Communicating stale/blocked/no-next-action without clutter

### Page Tasks:

1. **Areas Page** — List with weekly target and attention bar (from goal attention service)
2. **Goals Page & Detail** — Importance, target date, linked projects, "neglected" flag with reason
3. **Projects Page** — List with progress, health badges (no next action, stale N days, blocked)
4. **Project Detail** — Outcome, deadline, milestones (add/reorder/complete), next action selector, tasks list, linked panel (notes, people, events, bills)
5. **Task Editor** — Drawer with title, project, estimate, due, energy, priority, dependencies, notes
6. **Link Picker** — Reusable component used everywhere

### Unit Tests Required:

- Project progress bar reflects milestones (2/4 → 50%)
- Project with no next action shows the flag; setting one clears it
- Task estimate input parses `1h30` to 90 minutes
- Dependency picker cannot select the task itself or create a cycle (error shown)
- Link picker filters by type and links the entity

**What was done:**

- `structureService.ts`: every write for areas, goals, projects, milestones, tasks, and links, each validated through the core services and followed by `bumpData()`; `loadStructure` returns the snapshot plus health and attention maps; `loadLinked` resolves a project's links into notes, people, events, bills, and tasks; `loadLinkCandidates` feeds the picker
- `AreasPage`: inline create, inline rename, weekly-hours target, attention bar for the last 14 days, goal and project counts, delete refused with a toast when not empty
- `GoalsPage` grouped by area with importance dots, target date, project count, and a Neglected badge; `GoalPage` edits importance, target date, status, area, shows attention against expectation, lists projects, and creates one under the goal
- `ProjectsPage` with progress bar, percentage, area › goal, deadline, health badges, "show archived" toggle, and create with area + goal (goal list filtered by area)
- `ProjectPage`: outcome, deadline, status (archived cascades), goal, next-action selector (invalid when none), milestones with toggle / rename / move up-down / remove / add, task list with complete checkbox, Waits-on and Next badges, inline add (first task becomes the next action), and a linked panel with unlink; `HealthBadges` shows overdue / blocked / no next action / stale
- `TaskEditor` drawer (new `Drawer` primitive) keyed by task id: title, project, estimate with inline parse error, due date and optional time, energy, priority, dependency checkboxes that hide the task itself and disable anything that would create a loop, notes, archive
- `LinkPicker`: type tabs, search, Enter picks the first match, already-linked items hidden
- 11 new tests: milestone progress 2/4 → 50 % and toggle to 75 %, no-next-action flag set and cleared, inline milestone and task creation, link picker filter and link, estimate "1h30" → 90, unparseable estimate blocked, self excluded and cycle disabled in the dependency picker, dependency save, area → goal → project creation flow, non-empty area delete refused, goal detail edits

**Files created:**

- `apps/orbit/src/features/structure/{structureService.ts,useStructure.ts,AreasPage.tsx,GoalsPage.tsx,ProjectsPage.tsx,ProjectPage.tsx,TaskEditor.tsx}` ✅
- `apps/orbit/src/features/structure/{ProjectPage,TaskEditor,StructurePages}.test.tsx` ✅
- `apps/orbit/src/components/{LinkPicker.tsx,HealthBadge.tsx}`, `apps/orbit/src/components/ui/Drawer.tsx` ✅

**Deliverables:**

- [x] `apps/orbit/src/features/{areas,goals,projects,tasks}/*`
- [x] `apps/orbit/src/components/LinkPicker.tsx`
- [x] Unit tests written and passing

**Verification:**

```bash
pnpm run dev
# Create Area → Goal → Project → 3 tasks; set milestones; check progress and flags
```

---

## Week 5: Today Screen & Plan Proposal ✅ COMPLETE

**Description:** This week you will build the primary experience. The Today screen answers what matters, what to do next, what is at risk, where time is going, and what is neglected. It shows the main focus, the plan proposal with a "why" for each item and a "left out" list, at-risk items, a compact timeline, active projects, upcoming commitments, and the insights strip. The user accepts, regenerates, or edits the proposal.

### Research Required:

- **Information Hierarchy:** One dominant element (next action), secondary panels, no widget grid feel
- **Explanation UI:** Compact "why" popovers listing score components in plain language
- **Regenerate Feedback:** Diffing old vs new proposal, highlighting changes
- **Responsive Composition:** Desktop three-column, narrow single-column with the timeline collapsed

### Page Tasks:

1. **Today Layout** — Focus header (next action + start button), left column plan, center timeline (compact), right column at-risk / projects / commitments / insights
2. **Plan Proposal Panel** — Proposed tasks with duration, "why" popover, remove/add, left-out list with reasons
3. **Accept / Regenerate** — Accept writes commitment; regenerate shows a diff of changes
4. **At-Risk Panel** — Overdue, due soon without a block, projects nearing deadline
5. **Where Time Is Going** — Time by area for the last 7 days (small bar list, not a chart widget)
6. **Insights Strip** — Top 3 insights with expand for evidence (data from Week 11 engine; stub until then)

### Unit Tests Required:

- Renders next action from the proposal
- "Why" popover lists the explanation components
- Removing a proposed task moves it to left-out with reason `user`
- Accept calls `acceptPlan` and switches panel to committed state
- Regenerate highlights added/removed items

**What was done:**

- `todayService.ts`: `loadToday` reads every store once, runs `planDay`, and derives the committed timeline, at-risk items (overdue, due within 3 days without a block, projects within 7 days of deadline), time by area for the last 7 days, upcoming commitments, active projects with health, and a three-signal insight stub (neglected goals, stale projects, blocked projects, overdue tasks) with evidence lines; `acceptPlan` replaces the day's unlocked planner blocks and writes the commitment in one transaction; `unplanDay`, `startSession`, `stopSession`; `defaultPlanDate` plans tomorrow once the working window is over
- `planSettings.ts`: working window, rest boundaries, and energy per date in a persisted zustand store (Settings edits it in week 9)
- `TodayPage`: Today / Tomorrow switch, Low / Medium / High energy radio, focus header, insights strip, three columns above 900 px (plan, compact timeline, signals) and one column below with the timeline behind a disclosure
- `FocusHeader`: the next block ahead of now (or the first proposed), project link, Start / Stop (creates and closes a session) and Done (completes the task)
- `PlanPanel`: proposed rows with time, duration, "why" popover, remove; left-out list with reason chips and "Add back" for user removals; Accept and Regenerate; committed state lists the stored blocks with Re-plan; regenerate diff highlights new rows and names what was dropped
- `WhyPopover`: reasons as bullets, non-neutral score factors, the total, and where it was placed
- `CompactTimeline`: every block in time order with a now marker, past blocks dimmed, locked marker
- Storage banner gained "Export now" (JSON export through the platform) so a browser that refuses persistence still has a one-click backup
- 7 tests: next action rendered, why popover components, remove → `user` and add back, accept writes commitment + blocks and switches to committed (re-plan and accept again updates the same commitment), regenerate highlights added and dropped, energy switch leaves high-energy work out, at-risk and insight evidence

**Files created:**

- `apps/orbit/src/features/today/{todayService.ts,planSettings.ts,TodayPage.tsx,FocusHeader.tsx,PlanPanel.tsx,WhyPopover.tsx,CompactTimeline.tsx,SidePanels.tsx}` ✅
- `apps/orbit/src/features/today/TodayPage.test.tsx` ✅

**Deliverables:**

- [x] `apps/orbit/src/features/today/*`
- [x] Unit tests written and passing

**Verification:**

```bash
pnpm run dev
# Seed 20 tasks; open /today; accept; regenerate; confirm explanations
```

---

## Week 6: Time-Block Timeline ✅ COMPLETE

**Description:** This week you will build the full timeline. Events and suggested blocks appear on one day timeline. Users drag tasks from a side list into free time, resize blocks, move them, and lock important ones. Any change triggers recalculation of the rest of the day without moving locked blocks. Everything is reachable from the keyboard: arrows nudge by 15 minutes, `l` locks, `Delete` removes. Under 900px the timeline renders as a list so the PWA works on a phone.

### Research Required:

- **Drag & Drop:** `@dnd-kit` with custom collision for time grids; pointer vs keyboard sensors; touch sensor for the list variant
- **Resizing:** Edge handles, snapping to 15-minute grid, minimum block length
- **Rendering Performance:** Absolute positioning by minute-of-day, virtualization not needed for one day
- **Now Indicator:** Live line, auto-scroll on open, elapsed blocks styled as past

### Component Tasks:

1. **Timeline Canvas** — Hour gutter, now line, free interval shading, working window bounds
2. **Block Component** — Task/routine/event variants, locked state, past state, duration label
3. **Drag from Task List** — Side panel of unscheduled tasks; drop onto free time creates a block
4. **Move / Resize / Lock** — Pointer and keyboard; conflict rejection with a toast reason
5. **Recalculate Feedback** — After a change, moved blocks animate; a summary toast ("3 blocks moved, 1 locked kept")
6. **Day Navigation & List Variant** — Previous/next day, jump to today, week strip; list rendering under 900px

### Unit Tests Required:

- Dropping a task onto free time creates a block at the snapped time
- Resizing below 15 minutes is prevented
- Locked block ignores move attempts
- Arrow keys move the selected block by 15 minutes
- Recalculation never changes locked or past blocks (assert via mocked engine result)
- List variant renders under the breakpoint

**What was done:**

- `timelineService.ts`: `loadDay` (materializes routine instances and recurring-rule instances for the rolling window on the way in), `moveBlockTo` / `resizeBlockTo` / `dropTask` / `removeBlock` each validate through the core block operations, store the change, then `recalculate` the rest of the day in one transaction and return a summary; `toggleLock`; `firstFreeSlot` for keyboard-only scheduling
- `TimelineCanvas`: one pixel per minute, hour gutter, working-window shading, events, blocks, a live now line, opens scrolled to now; the canvas is the `@dnd-kit` drop target and the drop minute comes from the dragged element's translated top
- `TimelineBlock`: task / routine variants, locked and past states, duration label, draggable unless locked or past, bottom-edge pointer resize with live preview, snapped on release
- `UnscheduledPanel`: open tasks without a block today, draggable by their grip, or "Schedule" into the first free slot after now
- Keyboard on the selected block: ↑ / ↓ move 15 min, Shift+↑ / ↓ resize the end, `l` locks and unlocks, Delete removes, Esc deselects; every rejected change shows a toast with the engine's reason; every accepted change shows "Day re-planned: 2 moved, 1 kept"; moved blocks animate through a CSS transition on top and height
- `DayNav`: previous / next / today and a Monday-first week strip; `TimelineList` renders under 900 px (`useMediaQuery`) with the same actions as buttons (Earlier, Later, Lock, Remove)
- 8 tests: drop creates a manual block at the snapped time, Schedule uses the first free slot after now, arrows move 15 min and Shift resizes, resize below 15 min is refused with a reason, a locked block ignores moves and `l` unlocks it, a move onto a locked block is rejected and recalculation leaves past and locked blocks untouched, Delete removes, list variant under the breakpoint
- `@dnd-kit/core` added; the bundle baseline was re-based (264.6 KB gzip) after the +19.8 % growth it caused

**Files created:**

- `apps/orbit/src/features/timeline/{timelineService.ts,layout.ts,TimelinePage.tsx,TimelineCanvas.tsx,TimelineBlock.tsx,UnscheduledPanel.tsx,TimelineList.tsx,DayNav.tsx}`, `apps/orbit/src/lib/useMediaQuery.ts` ✅
- `apps/orbit/src/features/timeline/TimelinePage.test.tsx` ✅

**Deliverables:**

- [x] `apps/orbit/src/features/timeline/*`
- [x] Unit tests written and passing

**Verification:**

```bash
pnpm run dev
# Drag a task, resize, lock it, move another; verify locked block stays; resize window to 800px
```

---

## Week 7: Desktop Shell Integration ✅ COMPLETE

**Description:** This week the desktop runtime arrives and the UI learns the difference. You will add the `Platform.desktop` implementation over the Tauri APIs, wire the storage factory to SQLite on desktop, build the first-run flow (choose data folder, optionally import the browser export), the system-wide quick-capture window, native file dialogs for data settings, and capability-aware UI so web users see honest messaging about reminders and storage.

### Research Required:

- **Tauri JS API:** `invoke`, events, `plugin-dialog`, `plugin-notification`, `plugin-global-shortcut`, multi-window
- **Capability-Aware UI:** Rendering by `platform.capabilities` instead of user-agent sniffing
- **Always-On-Top Capture Window:** Small secondary window, focus on open, close on Enter/Escape
- **First-Run Flows:** Data folder choice, import from export, working window setup

### Page Tasks:

1. **Platform.desktop** — Implements the `Platform` interface with Tauri; storage factory returns SQLite
2. **First-Run Screen** — Data folder picker, "Import from Orbit web export" step, working window
3. **Quick Capture Window** — Global shortcut (`Ctrl+Shift+Space`) opens a small always-on-top capture window
4. **Data Settings (desktop)** — Data folder display/change, open folder in Explorer, integrity status
5. **Capability Messaging** — Web build shows "reminders only while open" and a storage-status banner; desktop hides them
6. **Window Behaviour** — Remember size/position; close-to-tray preference wired (tray itself lands in week 12)

### Unit Tests Required:

- Storage factory picks SQLite when `platform.capabilities.dataFolder` is true
- First-run flow persists folder + working window and lands on Today
- Capture window submits through the same CaptureBar component
- Capability messaging renders only on web platform (mocked)

**What was done:**

- `platform/desktop.ts`: `Platform` over Tauri with the packages imported lazily (the web bundle never carries them); `openDesktopRepository` reads or creates the data folder, opens `orbit.db` through `tauriSqlDriver`, runs the integrity check, and on a corrupt file quarantines it, restores the newest backup, and reopens; notifications through the plugin, export through a native save dialog, `desktop` extras (pick / relocate / reveal the data folder, pick an export file, list backups, hide the capture window, drag the frameless window)
- `platform/select.ts`: `isTauri()` is the only runtime sniff; `repositoryKindFor(platform)` picks SQLite when `capabilities.dataFolder` is true; `PlatformProvider` defaults to `detectPlatform()`
- `features/firstRun`: welcome flow on desktop until `orbit-first-run-done` is set — choose the data folder (relocates and restarts), import a browser export (merge, newer copies win), set the working window; lands on Today
- `QuickCaptureWindow` at `/capture`, outside the shell: the same `CaptureBar`, Enter saves and hides, Escape hides, refocuses on every show, draggable title strip
- Settings page (data and capability sections now, the rest in week 9): `DataSettings` shows the data folder with Change and Show in Explorer, the startup integrity result with an FTS5 badge, what recovery did, a close-to-tray preference (tray lands in week 12), and one-click JSON export; on the web it shows the honest storage status instead; `CapabilityNotes` says whether reminders fire in the background and which shortcut opens capture, by capability rather than user agent
- 12 tests: factory picks SQLite for a data-folder platform, the driver maps onto `db_*` commands, default folder on first run, corrupt file → quarantine → restore newest backup → reopen, fresh start without a backup, desktop export through the save dialog, first run persists folder and working window and lands on Today, inverted window refused, browser export imported, capture window submits through the shared bar and hides, capability messaging on web vs desktop

**Files created:**

- `apps/orbit/src/platform/{desktop.ts,select.ts,tauriSqlDriver.ts,desktop.test.ts}`, `types.ts` extended ✅
- `apps/orbit/src/features/firstRun/{FirstRunPage.tsx,firstRun.ts,FirstRunPage.test.tsx}` ✅
- `apps/orbit/src/features/inbox/{QuickCaptureWindow.tsx,QuickCaptureWindow.test.tsx}` ✅
- `apps/orbit/src/features/settings/{SettingsPage.tsx,DataSettings.tsx,SettingsPage.test.tsx}` ✅

**Deliverables:**

- [x] `apps/orbit/src/platform/desktop.ts`
- [x] `apps/orbit/src/features/firstRun/*`
- [x] `apps/orbit/src/features/inbox/QuickCaptureWindow.tsx`, window config in `tauri.conf.json`
- [x] Unit tests written and passing

**Verification:**

```bash
pnpm run tauri dev
# First run: choose folder, import web export; press Ctrl+Shift+Space from another app; capture
```

---

## Week 8: Morning Briefing, Evening Shutdown & Timer ✅ COMPLETE

**Description:** This week you will build the two daily review flows and the work timer. The morning briefing asks for energy level, shows at-risk items and bills due, then presents the plan for acceptance. The evening shutdown compares the commitment with what was done, asks for actual durations where no timer ran, and applies rollover choices. The timer runs from the Today screen and survives restarts.

### Research Required:

- **Guided Flow UX:** Stepper with progress, skip, resume; keyboard-only completion
- **Energy Input:** Three-state segmented control with hotkeys `1/2/3`
- **Duration Prompts:** Fast entry (`25`, `1h`), sensible defaults from estimate
- **Timer UI:** Document/window title update, tray tooltip on desktop, notification on long sessions

### Page Tasks:

1. **Morning Flow** — Steps: energy → at-risk & bills → plan proposal → accept
2. **Evening Flow** — Steps: committed vs done → actuals prompt → rollover choices → summary (time by area)
3. **Timer** — Start/stop on any task, active indicator in the focus header, persistence
4. **Completion Dialog** — Actual minutes prompt when completing without a session
5. **Review Launchers** — Today screen shows "Start morning briefing" before acceptance and "Evening shutdown" after 17:00 (configurable)

### Unit Tests Required:

- Morning flow sets energy and passes it to the planner call
- Evening lists exactly the unfinished committed tasks
- Rollover choice per task is submitted correctly
- Timer state restored from repository on mount
- Completion dialog prefills estimate

**What was done:**

- `features/timer/useTimer.ts`: reads the active session (and its task) from the repository on mount, so a restart resumes where the timer was; elapsed time is always `clock.now() − startAt`, a once-a-second tick only forces a render; one interval per running session kept in a ref and cleared on stop and unmount; `document.title` becomes `25:13 · Task name` while running and the page's own title comes back when it stops; exposes `start`, `stop`, `elapsed`
- `features/timer/timerService.ts`: `loadActiveTimer`, `startSession` (closes whatever was running in the same transaction), `stopSession`, `stopActiveSession`, `formatElapsed` (`m:ss`, `h:mm:ss` past an hour)
- `features/timer/CompleteTaskDialog.tsx` on the `Dialog` primitive: prefills the estimate (`1h 30m`, selected for overtyping), accepts `25`, `1h`, `1h30` through `parseDuration` with an inline error otherwise, has Skip; when the task already has a session it never shows and completes straight away with the actual taken from the sessions. Wired into the focus header's Done button and the project page task checkbox
- `FocusHeader` now runs on the hook: elapsed counter next to Stop, a note when the timer runs on a different task, Done opens the dialog
- `features/reviews/ReviewLaunchers.tsx` above the plan panel: "Start morning briefing" (for the day Today is planning) while it has no commitment; "Evening shutdown" (for today) once the working window has ended — `eveningStartMin` reads `usePlanPrefs` with 17:00 as the fallback until Settings arrive in week 9
- `features/reviews/MorningFlow.tsx` at `/review/morning?date=`: four steps on a shared `FlowShell` + `Stepper` (completed steps clickable, `aria-current="step"`). Energy uses the same `EnergyPicker` as Today (extracted into `features/today/EnergyPicker.tsx`) with `1` / `2` / `3` hotkeys through `useHotkey` that act on step one only; then at-risk and bills; then `PlanPanel` unchanged (remove, restore, regenerate, accept all work); then a summary. Accept calls the existing `acceptPlan` and navigates to Today
- `features/reviews/EveningFlow.tsx` at `/review/evening?date=`: committed vs done with a progress bar; an actual prompt per task completed without a session (prefilled from the estimate, blank skips, bad input blocks Next with a field error); a three-way segmented control per unfinished task defaulting to the rule's suggestion and showing where each choice lands; a summary with time by area. Submit goes through `submitEvening`, which writes every actual and rollover in one `repo.transaction`, then navigates to Today
- `features/reviews/reviewService.ts`: `loadMorning` / `loadEvening` build the core briefings from one repository read; `submitEvening` is the single write
- Today's at-risk panel and "where time went" now come from the shared core rules (`computeAtRisk`, `timeByArea` over the last seven local days, sessions split at midnight)
- 20 new tests (`Timer.test.tsx`, `CompleteTaskDialog.test.tsx`, `MorningFlow.test.tsx`, `EveningFlow.test.tsx`, `ReviewLaunchers.test.tsx`, three more in `TodayPage.test.tsx`): the five required ones — energy chosen with the `3` hotkey reaches `usePlanPrefs`, the proposal's `energy` field, and the stored commitment; the evening lists exactly the unfinished committed tasks; every rollover choice is submitted (P1 to tomorrow keeping its 17:00 due time, P3 switched to inbox); the timer restores a session seeded with `endAt: null` and shows `25:13` in the header and window title; the dialog prefills the estimate — plus ticking with fake timers and interval cleanup, closing the previous session on start, the dialog skipping itself, launcher visibility, and the empty evening
- `tests/e2e/playwright/core-loop.spec.ts`: the `test.fixme` is now a real run — morning briefing by hotkey → accept → timer survives a reload and titles the window → Done without a prompt → completion prompt from the project page → evening shutdown with one rollover to next week → the task carries next Monday's due date. The milestone test also waits for each milestone before adding the next (it raced under load)
- Manual cycle on `pnpm dev` done end to end; the rolled task is the first block in Monday's proposal

**Files created:**

- `apps/orbit/src/features/timer/{useTimer.ts,timerService.ts,CompleteTaskDialog.tsx,Timer.test.tsx,CompleteTaskDialog.test.tsx}` ✅
- `apps/orbit/src/features/reviews/{MorningFlow.tsx,EveningFlow.tsx,ReviewLaunchers.tsx,Stepper.tsx,reviewService.ts,MorningFlow.test.tsx,EveningFlow.test.tsx,ReviewLaunchers.test.tsx}` ✅
- `apps/orbit/src/features/today/EnergyPicker.tsx` ✅

**Deliverables:**

- [x] `apps/orbit/src/features/reviews/{MorningFlow,EveningFlow}.tsx`
- [x] `apps/orbit/src/features/timer/*`
- [x] Unit tests written and passing

**Verification:**

```bash
pnpm exec vitest run --project orbit reviews timer
pnpm run e2e
pnpm run dev
# Run a full morning → work with timer → evening cycle
```

---

## Week 9: Rules & Settings ✅ COMPLETE

**Description:** This week you will build the settings area and the four rule editors. Rules are structured forms, not sentences: time constraints, recurring scheduling, rollover policies, and reminders/follow-ups. Settings also cover working window, rest boundaries, backups, and export/import. Rule conflicts reported by the engine are shown inline. Reminder settings explain that background delivery is desktop-only.

### Research Required:

- **Form Patterns:** `react-hook-form` + Zod resolvers with the shared schemas from `@orbit/core`
- **Time Range Inputs:** Accessible start/end pickers, day-of-week selectors
- **Settings Architecture:** Settings store with validation, persisted through the repository
- **Export on Both Runtimes:** Blob download on web; native save dialog on desktop via `Platform`

### Page Tasks:

1. **Settings Layout** — Sections: Planning, Rules, Data, Appearance, Shortcuts
2. **Planning Settings** — Working window, rest boundaries, buffer between blocks, default estimates
3. **Rule Editors** — Constraint (no high energy after / reserve window), Recurring (n times per week), Rollover (priority → target), Reminder (bill within N days / follow-up after N days)
4. **Rule List** — Enable/disable, conflict badge with explanation
5. **Data Settings** — Export JSON/Markdown, import with dry-run report, backup list with restore (desktop), storage status (web)
6. **Shortcuts Reference** — Generated from the hotkey registry

### Unit Tests Required:

- Each rule form validates via the shared Zod schema and submits the right shape
- Conflict badge appears when the engine reports a conflict
- Working window end before start is rejected
- Export button invokes the platform export with the chosen format
- Import dry-run report renders counts before confirming

**What was done:**

- Forms without `react-hook-form`: every editor is a plain controlled form that builds a draft record and runs `RuleSchema.safeParse` (or `AppSettingsSchema`) on submit, mapping Zod issues to field messages with `zodErrors.fieldErrors`; `noValidate` so the shared schema, not the browser, is the one validator
- `SettingsPage` is a sectioned page with an in-page nav: **Planning**, **Rules**, **Data** (with the capability notes), **Appearance**, **Shortcuts**
- `PlanningSettings`: working window, rest boundaries as an editable list, gap between blocks, default estimate, and the evening hour; end before start is rejected with the first-run wording. `settingsService.loadSettings` creates the `AppSettings` document on first read — copying the working window and rest boundaries from the localStorage era once — and `saveSettings` validates, stores, and mirrors into `usePlanPrefs`, which is now an in-memory mirror (only the per-day energy still lives in localStorage). `SettingsProvider` hydrates before any route renders so the first proposal uses the user's window; `settingsFor` passes `bufferMin`; the evening launcher reads the evening hour; the first-run flow saves through the service
- `features/rules`: `ConstraintForm` (a toggle between "no demanding work after HH:MM" and "reserve weekday / from / to / for an area or keep free / label"), `RecurringForm` (routine select, times per week), `RolloverForm` (one select per priority), `ReminderForm` (bill within N days / follow up after N days); `RuleList` with enable toggles, edit, delete, a Conflict badge (tooltip) plus the engine's message under the row; `RulesSection` hosts the list and one editor at a time; `ruleService` reads rules with `detectConflicts`
- Data settings additions: **Export as Markdown** (the per-project and per-note files bundled into one `.md`) next to JSON; **import** with a dry run — pick a file (native dialog on desktop, file input on the web), see add / update / unchanged / remove counts, then Confirm; **backups** on desktop from `platform.desktop.listBackups()` newest first, Restore behind a confirmation that closes the database, sets the current file aside, copies the backup in, and reloads (`DesktopApi.restoreBackup`)
- `ShortcutsReference` generated from `HotkeyRegistry.list()` (descriptions and groups were already there), grouped and rendered with `Kbd`, plus the screen-bound keys; `AppearanceSettings` with a reduce-motion preference (`data-motion="reduced"` on the root)
- Reminders on the web: `useReminderScheduler` (mounted in `App`) reconciles the queue from the reminder rules once a minute and after every write on both runtimes, and where the shell has no native scheduler fires due reminders as persistent toasts with Dismiss. `CapabilityNotes` now says, by capability, whether reminders show in-app, as system notifications while running, or in the background
- 19 new tests: each rule form submits the right shape and the shared schema rejects bad input (`7pm`, a reserved window ending before it starts, 9 times a week); the conflict badge appears on both rules with the engine message and clears when one is disabled; edit keeps the id; the working window end before start is rejected and a valid save lands in the document; JSON and Markdown export call `platform.exportFile` with the right name and type; the dry-run report shows counts before anything is written and the confirm imports; backups list and restore; the shortcuts reference; the settings service migration; the scheduler on web (toast once, dismiss, no duplicate on the next poll) and desktop (queue only)
- Manual check on `pnpm dev` against last week's data (a real IndexedDB v2 → v3 upgrade): "No demanding work after 19:00" added, the working window widened to 22:00, a 6 h high-energy task left out with "only 5h free in one stretch" while the rule is on and placed 14:00–20:00 with it off; a bill captured due tomorrow with a 3-day rule raised the reminder toast at once

**Files created:**

- `apps/orbit/src/features/rules/{RuleForms.tsx,RuleList.tsx,RulesSection.tsx,ruleService.ts,zodErrors.ts,RulesSection.test.tsx}` ✅
- `apps/orbit/src/features/settings/{PlanningSettings.tsx,ImportSettings.tsx,BackupList.tsx,ShortcutsReference.tsx,AppearanceSettings.tsx,SettingsProvider.tsx,settingsService.ts,SettingsSections.test.tsx}` ✅
- `apps/orbit/src/features/reminders/{reminderService.ts,useReminderScheduler.ts,useReminderScheduler.test.tsx}` ✅

**Deliverables:**

- [x] `apps/orbit/src/features/settings/*`
- [x] `apps/orbit/src/features/rules/*`
- [x] Unit tests written and passing

**Verification:**

```bash
pnpm run dev
# Add "no demanding work after 19:00"; plan the day; confirm no high-energy blocks after 19:00
```

---

## Week 10: Command Palette & Global Search

**Description:** This week you will build the keyboard command center. `Ctrl+K` opens a palette that mixes commands ("Add task", "Plan my day", "Show neglected goals", "Review this week", "Reschedule unfinished work") with global search results across tasks, notes, projects, and people. Commands with arguments prompt inline. Results show type chips and snippets and open the entity on Enter.

### Research Required:

- **Command Palette UX:** `cmdk` patterns, grouping, recent items, argument prompting
- **Search Result Rendering:** Highlighted snippets, type filters via `type:` syntax
- **Debouncing & Cancellation:** Keeping the palette responsive at 50k records
- **Global Search Page:** Full results view for long lists

### Component Tasks:

1. **CommandPalette** — Open/close, fuzzy command match, recent commands, groups
2. **Argument Prompts** — Inline steps for commands needing input (e.g. Add task → capture bar inside palette)
3. **Search Results** — Mixed results from `SearchService` with type chips, snippet highlighting, `type:` filters
4. **Search Page** — `/search?q=` full list with filters sidebar
5. **Entity Quick Actions** — From a result: open, complete, schedule today, link

### Unit Tests Required:

- `Ctrl+K` opens; Escape closes; focus returns to trigger
- Typing "plan" lists "Plan my day" first
- "Add task" prompts for text then invokes the command
- Search results show correct type chips
- `type:note` filter excludes tasks

**Deliverables:**

- [ ] `apps/orbit/src/features/palette/*`
- [ ] `apps/orbit/src/features/search/*`
- [ ] Unit tests written and passing

**Verification:**

```bash
pnpm run dev
# Ctrl+K → "find notes about university" → open a note
```

---

## Week 11: Insights & Project Health Surfaces

**Description:** This week you will surface system intelligence. The insights panel lists observations with severity, a plain-language explanation, and expandable evidence linking to the exact records. Users can snooze or dismiss. Project and goal lists gain health indicators driven by the same engine, and the Today screen's insights strip goes live.

### Research Required:

- **Evidence Presentation:** Small tables or lists that link to entities without overwhelming
- **Trust Signals:** Showing the threshold and sample size next to each claim
- **Noise Control UX:** Snooze durations (1 day / 1 week / until data changes), dismissed history
- **Severity Styling:** Gold for attention, danger for risk; never more than three severities

### Page Tasks:

1. **Insights Page** — List grouped by severity, evidence expander, snooze/dismiss actions
2. **Insight Card** — Title, detail, threshold + sample size, evidence list with links
3. **Today Strip Wiring** — Top 3 by severity with "see all"
4. **Health Badges** — Reusable `HealthBadge` used on projects and goals lists
5. **Overloaded Day Warning** — Timeline header shows overload with evidence link

### Unit Tests Required:

- Insight card renders evidence rows that link to entities
- Snooze hides the card and calls the state store with the right date
- Today strip shows at most three
- Health badge maps each state to the right label
- Timeline header shows the overload warning when the engine reports one

**Deliverables:**

- [ ] `apps/orbit/src/features/insights/*`
- [ ] `apps/orbit/src/components/HealthBadge.tsx`
- [ ] Unit tests written and passing

**Verification:**

```bash
pnpm run dev
# Seed a stale project and an overloaded Wednesday; verify both insights appear with evidence
```

---

## Week 12: Weekly Review, People, Bills & Notes

**Description:** This week you will build the guided weekly review and the thin list screens for people, bills, and notes. The weekly review walks through inbox zero, overdue cleanup, every active project, goal updates, bills, and next-week capacity, and can be paused and resumed. People show commitments and follow-ups; bills show due dates with reminder status; notes have a Markdown editor with links. On desktop, tray menu actions ("Plan my day") route into the app.

### Research Required:

- **Long Guided Flows:** Progress persistence, per-step summaries, keyboard completion
- **Markdown Editing:** Lightweight editor (CodeMirror 6 or a textarea with preview) — bundled, offline
- **Relationship UI:** Commitment direction (owed by me / to me), last contact, follow-up state
- **Tray Events:** Handling Tauri tray menu events and notification clicks as deep links

### Page Tasks:

1. **Weekly Review Flow** — Six steps with resumable progress and a closing summary
2. **Project Inspection Step** — For each active project: health, set next action inline, archive option
3. **People Page & Detail** — Commitments list, add commitment, mark replied, follow-up badge
4. **Bills Page** — Due list, paid toggle, recurrence display, due-soon highlighting
5. **Notes Page & Editor** — Markdown editor with preview, link picker, project/area assignment
6. **Tray & Notification Routing** — Deep links from tray menu and reminder clicks open the right screen

### Unit Tests Required:

- Weekly review resumes at the saved step
- Project step lets the user set a next action and clears the flag
- Person detail shows commitments count badge at ≥ 3
- Bill due within 3 days shows due-soon state
- Notes editor saves on blur and renders preview
- Deep link `orbit://task/<id>` opens the task editor

**Deliverables:**

- [ ] `apps/orbit/src/features/reviews/WeeklyFlow.tsx`
- [ ] `apps/orbit/src/features/{people,bills,notes}/*`
- [ ] `apps/orbit/src/platform/deepLinks.ts`
- [ ] Unit tests written and passing

**Verification:**

```bash
pnpm run tauri dev
# Run the weekly review end to end; pause mid-way, reopen, resume; click a reminder toast
```

---

## Week 13: Mobile PWA Layouts, Accessibility & Polish

**Description:** This week you will make Orbit hold up on a phone and under audit. The PWA on mobile is capture, the Today list, timer, and reviews; the timeline is a list and structure screens are read-mostly. Narrow desktop windows collapse to a single column. You will run an accessibility audit (contrast, keyboard, screen reader), tune motion and loading states, fix the top usability issues, and prepare the interface for the 1.0 release.

### Research Required:

- **Mobile PWA UX:** Bottom navigation, safe areas, touch targets ≥ 44px, install prompts on iOS and Android
- **Responsive Desktop Windows:** Container queries, collapsing nav rail to icons
- **WCAG 2.1 AA:** Contrast for lime/gold, focus order, live regions, reduced motion
- **Screen Readers:** NVDA on Windows with WebView2 and Chromium; VoiceOver basics on iOS
- **Perceived Performance:** Skeletons vs instant local data; avoiding flashes

### Tasks:

1. **Mobile Layouts** — Bottom nav (Today, Inbox, Capture, Reviews, More); capture-first home on phone
2. **Narrow Desktop Layouts** — Nav rail collapses; Today becomes single column
3. **Accessibility Audit** — Automated (axe) + manual keyboard, NVDA, and VoiceOver pass; fix all serious issues
4. **Contrast Pass** — Verify every token pair; adjust gold text variant
5. **Motion & Feedback Pass** — Consistent 120–180ms transitions; reduced-motion respected everywhere
6. **Bug Bash** — Triage and fix issues logged during Weeks 3–12
7. **Release Polish** — App icon, window defaults, install prompt copy

### Unit Tests Required:

- axe reports zero serious/critical violations on each main route
- Bottom nav renders under the mobile breakpoint; nav rail above it
- Reduced-motion media query disables transitions (class assertion)
- Touch targets in mobile layout meet the minimum size (style assertion)

**Deliverables:**

- [ ] Mobile and narrow layouts for all main routes
- [ ] Accessibility audit report in `docs/A11Y-AUDIT.md` with fixes applied
- [ ] Unit tests written and passing

**Verification:**

```bash
pnpm run test --filter orbit
pnpm run build && pnpm run preview
# Open on phone over LAN, install, airplane mode, capture; desktop: resize to 800px, keyboard only
```

---

## Summary: Frontend Implementation Status

| Week        | Feature Area                                  | Status      | Progress |
| ----------- | --------------------------------------------- | ----------- | -------- |
| **Week 1**  | Vite + React Setup, Design Tokens & App Shell | ✅ COMPLETE | 100%     |
| **Week 2**  | Base Component Library & PWA Shell            | ✅ COMPLETE | 100%     |
| **Week 3**  | Universal Inbox                               | ✅ COMPLETE | 100%     |
| **Week 4**  | Areas, Goals, Projects & Tasks                | ✅ COMPLETE | 100%     |
| **Week 5**  | Today Screen & Plan Proposal                  | ✅ COMPLETE | 100%     |
| **Week 6**  | Time-Block Timeline                           | ✅ COMPLETE | 100%     |
| **Week 7**  | Desktop Shell Integration                     | ✅ COMPLETE | 100%     |
| **Week 8**  | Morning Briefing, Evening Shutdown & Timer    | ✅ COMPLETE | 100%     |
| **Week 9**  | Rules & Settings                              | ✅ COMPLETE | 100%     |
| **Week 10** | Command Palette & Global Search               | ⏳ PENDING  | 0%       |
| **Week 11** | Insights & Project Health Surfaces            | ⏳ PENDING  | 0%       |
| **Week 12** | Weekly Review, People, Bills & Notes          | ⏳ PENDING  | 0%       |
| **Week 13** | Mobile PWA Layouts, Accessibility & Polish    | ⏳ PENDING  | 0%       |

**Total Progress:** 9/13 weeks complete (69%)
