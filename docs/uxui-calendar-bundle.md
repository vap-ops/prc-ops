# PRC Ops — KANNA-style schedule calendar (Unit D) — Design Brief + Source Bundle

> **You have NO access to the repo.** Everything is inline under
> `===== FILE: <path> =====` markers. Return full file contents for anything new
> or changed; do not ask to open files.

## Who you are

Senior product designer + frontend engineer building the **WP schedule calendar**
for PRC Ops — a Thai-first, sunlight-readable, mobile-first PWA for a Thai
construction contractor. This is the visual layer on top of the just-shipped
critical-path engine (spec 92 Units A–C). Reference: **KANNA** (アルダグラム's
construction PM app) — a Gantt/工程表 with task bars on a timeline, Month/
Quarter/Year period switch, dependencies shown visually, nested project →
sub-project → process. We build the WP-centric equivalent on the Field-First
tokens — NOT a clone.

## What to build

A new route **`/projects/[id]/schedule`** (server component fetches data + passes
to a client calendar component) plus the calendar component(s). It visualizes
the project's work packages across a date timeline.

### Data you are GIVEN as props (already fetched server-side — do not re-fetch)

- `workPackages: { id, code, name, status, deliverableId, plannedStart, plannedEnd, priority, isCritical }[]`
  - `status` ∈ not_started | in_progress | on_hold | pending_approval | complete
  - `plannedStart`/`plannedEnd`: ISO date strings or null (null = unscheduled)
  - `priority` ∈ normal | urgent | critical ; `isCritical`: boolean (on the critical path)
- `deliverables: { id, code, name, sortOrder }[]` — the งวดงาน groups (KANNA's sub-projects)
- `dependencies: { predecessorId, successorId }[]` — finish-to-start edges
- `projectId`, `projectName`, `projectCode`

### Requirements

- **Rows grouped by งวดงาน (deliverable)**, sortOrder asc; ungrouped WPs last.
- **Bars** span plannedStart..plannedEnd on a horizontal date timeline.
- **Critical path highlighted** — `isCritical` WPs get a distinct treatment
  (danger/attn). Priority urgent/critical can show the ด่วน marker too.
- **Status color** the bar via the Field-First status tokens (done=emerald,
  in-progress/current=amber attn, pending=wait sky, on_hold=muted, etc.) — reuse
  the conventions in the pasted `action-bands.ts` / `status-colors.ts`.
- **Dependency links** between bars (finish-to-start). On mobile, full arrows may
  be too busy — propose a legible approach (e.g. a connector line, or a "ขึ้นกับ"
  marker that highlights predecessors on tap). Your call; explain it.
- **Period switch: เดือน / ไตรมาส / ปี (Month / Quarter / Year)** — changes the
  timeline scale (KANNA's core control), top-right.
- **Today marker** — a vertical "วันนี้" line.
- **Tap a bar → the WP detail** (`/projects/[id]/work-packages/[wpId]`).
- **Unscheduled WPs** (null dates) → a separate "ยังไม่กำหนดวันที่" list below the
  timeline, not on it.
- **Mobile-first:** horizontal-scroll timeline with a sticky left WP-name column;
  sunlight contrast; ≥44px tap targets; Thai never `truncate` (use line-clamp).

## Hard constraints

- Field-First tokens ONLY (pasted globals.css). NEVER raw Tailwind palette
  colors (no bg-zinc-_/blue-_/etc) — use bg-card/page/sunk, text-ink/-secondary,
  bg-attn/done/wait/danger + -soft/-edge/-ink, rounded-card/control, text-display
  /title/heading/section/body/meta, etc.
- Thai-first; mobile-first; WP identity (code + name) always legible.
- Reuse PageShell + DetailHeader (pasted) for the route's shell + back nav.
- Don't change the schema or the data contract; consume the props above.

## Deliverable

1. The route: `src/app/projects/[projectId]/schedule/page.tsx` (server fetch +
   render the calendar). I will wire the exact Supabase queries — you can stub
   the fetch and focus the props shape, OR write it against the patterns in the
   pasted project page; I'll reconcile.
2. The calendar client component(s) under `src/components/features/`.
3. A short note on the dependency-visualization choice + the period-switch UX.
   Do NOT write final code until the operator approves the design direction —
   first describe + (if helpful) sketch the layout, then build on approval.

---

# SOURCE BUNDLE

===== FILE: docs/feature-specs/92-wp-schedule-critical-path.md =====

# Spec 92 — WP schedule + critical path (KANNA-style)

**Status:** proposal (2026-06-14). The third and final follow-up to the
Field-First worklist (after the manual priority flag + next-action verbs).
Lights the reserved `is_critical` / CRITICAL_BADGE slot and adds a schedule
view. Operator direction: **manual dependency + duration entry in-app, with a
schedule calendar similar to KANNA** (アルダグラム's construction PM app).

## Reference — KANNA (what to match)

KANNA's schedule = a Gantt/工程表: task rows on a timeline, **Month / Quarter /
Year** period switch, **dependencies shown visually** between tasks, **nested**
project → sub-project → process (maps to our **project → งวดงาน (deliverable) →
work package**), progress monitoring, plus a **calendar** view of who's doing
what when. We build the WP-centric, Thai-first, mobile-first, sunlight-readable
equivalent on the Field-First tokens — not a clone.

## Why (operator goal)

Completes the alignment story. The manual priority flag is the human override;
the critical path is the SCHEDULE truth — the WP chain whose slip slips the
project. With both, the worklist's top item = the highest-leverage work for the
whole company, and the calendar makes the plan legible.

## Data model (manual, in-app)

- `work_packages.planned_start date null`, `planned_end date null` — the PM-set
  planned window (the Gantt bar). Nullable; unscheduled WPs simply don't appear
  on the timeline. Duration is derived (`planned_end − planned_start`).
- NEW `work_package_dependencies` (predecessor_id → successor_id, finish-to-start
  only for v1): id, predecessor_id FK, successor_id FK, created_by, created_at;
  UNIQUE(predecessor, successor); CHECK predecessor ≠ successor; both FKs within
  the same project (enforced in the setter RPC). RLS: SELECT staff
  (sa/pm/super), INSERT/DELETE pm/super — mirrors `work_package_members`.
- `is_critical` is **computed on read** (CPM in TS), NOT stored — no trigger /
  refresh machinery; ~80 WPs/project is trivial to compute server-side. The
  worklist already consumes `isCritical` as a prop.
- Writes via SECURITY DEFINER RPCs (mirror `set_work_package_contractor`):
  `set_work_package_schedule(wp, start, end)` and
  `add/remove_work_package_dependency(pred, succ)` — PM/super only, with the
  same-project + no-cycle checks inside.

## CPM (pure, testable)

`src/lib/work-packages/critical-path.ts`: given WPs (with planned_start/end) +
dependencies, run the standard forward/backward pass → earliest/latest
start-finish → float; **float = 0 ⇒ on the critical path**. Cycle-guarded
(the RPC also rejects cycles at write time). Pure function, unit-tested; the
project page feeds the result into `isCritical` so the badge lights.

## Units

- **A — schema** (this is the only DB unit): the 2 columns + dependencies table
  - the 3 setter RPCs + RLS/grants + pgTAP. Apply to prod via the merged-then-
    push flow. Bounded + safe (additive); won't change with calendar design.
- **B — CPM engine**: `critical-path.ts` + tests; wire `isCritical` into the
  project page → worklist CRITICAL_BADGE lights for path WPs.
- **C — input UI** (WP detail, PM/super): a "ขึ้นกับงาน" (depends-on) picker
  over same-project WPs + planned start/end date fields. This is the manual
  entry the operator asked for; minimal, consistent with the priority control.
- **D — schedule calendar (KANNA-style)**: the big design surface. WP rows
  grouped by งวดงาน, bars across a date timeline, dependency links, critical
  path highlighted (danger/attn), Month/Quarter/Year period switch, today
  marker, Field-First tokens, mobile-first (horizontal scroll timeline + tap a
  bar → WP detail). New route under the project, e.g. `/projects/[id]/schedule`.

## Open decisions for the operator (cheap to confirm, expensive to redo)

1. **Dates vs duration** — recommend PM sets **planned_start + planned_end**
   (matches KANNA bars); duration derived. (Alt: start + duration → end derived.)
2. **Dependency type** — recommend **finish-to-start only** for v1 (the 99%
   case); add SS/FF/SF later if needed.
3. **Calendar build route** — Unit D is design-heavy and you have a high bar.
   Either (a) route the calendar mock to the design agent first (the proven
   path for big UI, like the reskin), or (b) I build it directly on the tokens
   and you spot-check. A–C are safe for me to build autonomously now.

## Done when

Each unit: `typecheck && lint && test && build` green; Unit A also `db:test`
green + verified on prod. The CRITICAL_BADGE lights from real dependencies; the
schedule calendar renders the project timeline with the critical path marked.

===== FILE: docs/ui-conventions.md =====

# UI Conventions

Consolidated from the design-system specs (14, 17–20, 28, 38, 40, 41) and the
code as of 2026-06-12. This is the reference for any new screen or component.
The specs remain the authority for _why_; this doc records _what is current_.
If a convention here conflicts with newer shipped spec work, update this doc
in the same unit.

## 1. Language — Thai-first (spec 14)

- Every user-facing string is Thai: headings, nav, buttons, pills, empty
  states, error strips, form labels/placeholders, hints, aria-labels,
  confirm text, metadata.
- **Latin stays Latin:** `PRC Ops`, `LINE` (brands), project/WP/deliverable
  codes, `PDF`, file-format names (JPEG/PNG/WebP/HEIC).
- Enum values, route paths, redirect targets are storage keys — never
  translated. The label is presentation only.
- The binding glossary lives in spec 14 §A. All new copy must reuse its
  terms (โครงการ, รายการงาน, คำขอซื้อ, …).
- Thai has no plurals: counts render as `{n} รายการ`, no ternaries.
- Single-language by design — no i18n library, no locale switcher.

### Labels and dates — `src/lib/i18n/labels.ts`

The only place enum labels live. Never write a per-file status-label map.

- Maps: `WORK_PACKAGE_STATUS_LABEL`, `PROJECT_STATUS_LABEL`,
  `PURCHASE_REQUEST_STATUS_LABEL`, `PURCHASE_REQUEST_PRIORITY_LABEL`,
  `PHOTO_PHASE_LABEL`, `APPROVAL_DECISION_LABEL`, `USER_ROLE_LABEL`.
- Dates: `formatThaiDateTime(iso)` / `formatThaiDate(iso)` —
  `th-TH-u-ca-buddhist` (Buddhist era) pinned to `Asia/Bangkok`, so server
  and client render identically. Never call `toLocaleString` directly.
- `tests/unit/i18n-labels.test.ts` enforces: every enum value labeled,
  labels non-empty and distinct per map.

## 2. Typography and document setup

- Font: **Sarabun** via `next/font/google`, subsets `["thai", "latin"]`,
  weights `400/500/600` only (not a variable font — weight is mandatory).
  Matches the PDF font (spec 13). `--font-sans: var(--font-sarabun)`.
- **Geist Mono** for codes only (project/WP codes): `font-mono text-xs`.
- `<html lang="th">`; metadata title template `%s — PRC Ops`; per-route
  static Thai `metadata.title`.

## 3. Color doctrine — sun-readable light theme (spec 20, amended by 38/40)

Users are outdoors on phones. Light ground wins in glare; dark pixels become
a mirror. Hard floors:

- Ground is light. Pages: `bg-zinc-50`; cards/headers: `bg-white`. Ink is
  `text-zinc-900`. No `.dark` class is ever set; `html { color-scheme:
light; }` in `globals.css` blocks Chrome Android force-dark. Theme color
  `#ffffff`.
- **No mid-gray meaningful text.** Secondary-text floor is `zinc-600`.
  `zinc-400/500` only for decoration (dividers, disabled, placeholder).
- **Hue roles are exclusive:**
  - `blue-700` — links and active nav only (`text-blue-700`).
  - `slate-900` — primary action fills (spec 40: `bg-slate-900`,
    hover `slate-800`) and the brand header band.
  - `amber-400` — brand accent (the "Ops" in the wordmark, deliverable
    group `border-l-4`).
  - zinc / amber / emerald / red / sky — status pill slots only.
  - `red-600` — destructive actions.
- Status = solid saturated fills, identifiable by hue alone at arm's length
  — never tinted translucency.
- Recorded dark exceptions: ConfirmDialog and PhotoLightbox scrims
  (`bg-black/85`), the LINE login button, the AppHeader brand band.

## 4. Status pills

- Component: [status-pill.tsx](../src/components/features/status-pill.tsx).
  Geometry: `shrink-0 rounded-full border px-3 py-1 text-sm font-semibold`.
- Colors come ONLY from [status-colors.ts](../src/lib/status-colors.ts) —
  never hardcode pill classes in a page. Six helpers:
  `projectStatusPillClasses`, `workPackageStatusPillClasses`,
  `approvalDecisionPillClasses`, `reportStatusPillClasses`,
  `purchaseRequestStatusPillClasses`, `purchaseRequestPriorityPillClasses`.
- The six palette slots (contrast-audited; see spec 20 §1a amendments):

  | Slot         | Classes                                        | Meaning                 |
  | ------------ | ---------------------------------------------- | ----------------------- |
  | PILL_ZINC    | `border-zinc-400 bg-zinc-200 text-zinc-900`    | neutral / not started   |
  | PILL_AMBER   | `border-amber-600 bg-amber-400 text-zinc-950`  | in progress / attention |
  | PILL_EMERALD | `border-emerald-800 bg-emerald-700 text-white` | done / approved         |
  | PILL_RED     | `border-red-700 bg-red-600 text-white`         | rejected / failed       |
  | PILL_SKY     | `border-sky-800 bg-sky-700 text-white`         | in transit              |
  | PILL_MUTED   | `border-zinc-300 bg-zinc-100 text-zinc-600`    | archived / cancelled    |

  Amber keeps dark text (white-on-amber fails AA); emerald is 700 not 600
  (white-on-600 = 3.67:1, fail).

## 5. Layout

### Page width — `PAGE_MAX_W` (spec 41)

One canonical token in [page-width.ts](../src/lib/ui/page-width.ts):
`max-w-2xl md:max-w-4xl lg:max-w-6xl xl:max-w-7xl`. Every content page's
header strip, nav strip, and content container use it. `AppHeader`/`HubNav`
accept only `typeof PAGE_MAX_W` — the type system prevents drift.
Recorded exceptions: `/login`, `/profile`, `/coming-soon` — single-card
form screens at `max-w-md`.

### Page anatomy

```
<PageShell>                                ← THE scroller (spec 64); body is locked
  <DetailHeader …> | <AppHeader …>         ← sticky chrome (spec 62/63)
  <section class="mx-auto {PAGE_MAX_W} px-5 py-6">   ← gap-8 between sections
```

- Every route renders `PageShell`
  ([page-shell.tsx](../src/components/features/page-shell.tsx), spec 64)
  — the body is `overflow-hidden`; the shell's `<main>` is the only
  scroll container, so sticky headers and fixed chrome cannot drift on
  iOS bounce. Variants: `app` (content pages), `card` (single-card
  screens), `bare`. Hand-rolling a `<main>` is a review reject.
- The `app` variant's `pb-20 sm:pb-0` clears the phone tab bar.
- **Exception — WP detail (Field-First reskin Unit 1):** the WP detail page
  omits `BottomTabBar`; the fixed amber capture bar owns the thumb zone and the
  back chip is the return nav. The only screen exempt from the bottom-tabs
  contract.
- Back link: `text-xs font-medium text-blue-700 hover:underline`, text
  `← {ชื่อหน้าก่อนหน้า}` (back-nav targets are locked behavior, spec 12).
- Title: `text-xl font-semibold tracking-tight`; code above it in
  `font-mono text-xs text-zinc-600`. DETAIL pages (WP, request) use the
  spec-54 scale instead: `text-2xl font-bold tracking-tight`.
- **Detail headers render `DetailHeader`**
  ([detail-header.tsx](../src/components/features/detail-header.tsx),
  spec 63) — back chip + refresh + actions slot + sticky chrome in one
  shell. Hand-rolling a detail header is a review reject.
- **Shared chrome classes live in
  [classes.ts](../src/lib/ui/classes.ts)** (spec 63): `BUTTON_PRIMARY`,
  `BUTTON_SECONDARY`, `ICON_CHIP`, `ICON_CHIP_MUTED`, `INLINE_ERROR`,
  `CARD`, and (spec 65) `SECTION_HEADING`, `DETAIL_TITLE`,
  `FIELD_INPUT`, `FIELD_SELECT`, `FIELD_STACKED`,
  `BUTTON_PRIMARY_COMPACT`, `BUTTON_SECONDARY_COMPACT`,
  `BUTTON_SECONDARY_MUTED`, `INLINE_ALERT_TEXT`, `BANNER_ERROR`.
  Copying these class strings inline is a review reject — import the
  constant. Every value is pinned byte-for-byte in
  `tests/unit/ui-classes-spec65.test.ts`.
- Section heading: `SECTION_HEADING`
  (`mb-3 text-base font-semibold text-zinc-900`).

### Names and truncation (spec 57)

The WP is the center of information — scope, time, and resource all map
against it (operator principle, 2026-06-13). Its identity must stay
readable:

- Detail-page subject (WP name, request item description): NEVER
  truncate — `break-words`, full wrap, no clamp.
- List rows (WP list, PM queue): `line-clamp-2 break-words` — bounded
  rows, never single-line `truncate`.
- Meta/context lines (project line, WP link on a request) may truncate —
  they are context, not the page's subject.

### Cards, lists, panels (spec 38 class map)

- Card / list item: `rounded-xl border border-zinc-200 bg-white px-4 py-3
shadow-sm` (rows min-h-16).
- Sub-panel: `rounded-lg border border-zinc-200 bg-zinc-50`.
- Card lists on hub pages go `lg:grid-cols-2` — width buys density, not
  stretched cards (spec 40).
- Deliverable groups (work-package-list): one elevated white card per
  group; header = slate-50 band with `border-l-4 border-amber-400`, bold
  slate-900 name, mono code; WPs are divided rows inside with hover wash
  and `ring-inset` focus. Flat mode (no deliverables) keeps standalone
  cards. (spec 40 §3)
- Photo galleries: horizontal filmstrip, never a growing grid (spec 49).
  Use `PhotoStrip` + `PHOTO_STRIP_TILE` from
  [photo-strip.tsx](../src/components/features/photo-strip.tsx) —
  fixed-square `h-28 w-28 shrink-0 snap-start` tiles in one
  `overflow-x-auto snap-x` row; phase headings announce the count
  `({n})`. Page height stays constant regardless of photo volume.

## 6. Shared chrome

- **AppHeader** ([app-header.tsx](../src/components/features/app-header.tsx))
  — the slate-900 brand band (spec 38): wordmark `PRC` white + `Ops`
  amber-400, white heading (สวัสดี คุณ{fullName}), desktop-only โปรไฟล์
  link, dark-variant logout. Hub pages only — detail screens keep light
  breadcrumb headers (they are content, not chrome).
- **HubNav** ([hub-nav.tsx](../src/components/features/hub-nav.tsx)) —
  desktop only (`hidden sm:block`), `bg-zinc-100` strip; active item
  `border-b-2 border-blue-700 font-semibold`.
- **BottomTabBar**
  ([bottom-tab-bar.tsx](../src/components/features/bottom-tab-bar.tsx)) —
  phone only (`sm:hidden`), fixed bottom, `bg-white/95 backdrop-blur` +
  `pb-[env(safe-area-inset-bottom)]`; active tab `text-blue-700` with top
  indicator bar; longest-prefix-wins matching. SA tabs: โครงการ / คำขอซื้อ /
  โปรไฟล์. PM tabs: รอตรวจ / โครงการ / คำขอซื้อ / โปรไฟล์.
  **Rendered on every screen EXCEPT WP detail** (Field-First reskin Unit 1),
  where the fixed capture bar takes the thumb zone instead.

## 7. Controls and forms

- **Touch targets:** 44 px minimum (`h-11` inputs/buttons, `min-h-11`
  chips/tabs, 56 px WP rows) — gloved-hands convention (spec 18).
- Primary button: `rounded-lg bg-slate-900 shadow-sm` + hover `slate-800`
  - `active:translate-y-px`, white text.
- Secondary: `rounded-lg border border-zinc-300 bg-white shadow-xs`.
- Fields: `rounded-lg border border-zinc-400 bg-white shadow-xs` — fields
  KEEP `zinc-400` borders (WCAG 1.4.11 boundary; zinc-300 regressed to
  1.48:1, lens-caught in spec 38).
- Focus: blue ring with `focus-visible:ring-offset-2` on solid fills.
- **Save lifecycle:** button `บันทึก` → `กำลังบันทึก…` (disabled, inputs
  disabled) → on round-trip success a `role="status"` span
  `text-xs font-medium text-emerald-700` reading `บันทึกแล้ว`. Never show
  "saved" before the server confirms.
- **Error strips:** `role="alert"`, `rounded-md border border-red-300
bg-red-50 px-3 py-2 text-xs text-red-900`. Message text ends with
  `กรุณาลองใหม่อีกครั้ง` unless a more specific action applies.
- **Notices** ([notices.tsx](../src/components/features/notices.tsx)):
  `ErrorNotice` (red-600 border, red-50, `font-medium text-red-900`) for
  fetch failures; `EmptyNotice` (zinc, centered `text-zinc-600`) for empty
  lists — always a concrete Thai sentence (ยังไม่มีโครงการ,
  ไม่มีรายการรอตรวจ), never blank space.
- **ConfirmDialog**
  ([confirm-dialog.tsx](../src/components/features/confirm-dialog.tsx)):
  `bg-black/85` scrim (recorded dark exception), `max-w-sm` white box,
  ยกเลิก + red-600 confirm, Escape/overlay-click cancels. No
  `window.confirm`.

## 8. Loading

Every route group has a `loading.tsx` rendering
[page-skeleton.tsx](../src/components/features/page-skeleton.tsx) — it
mirrors the page anatomy (zinc-50 main, white header strip, `h-16
rounded-lg` row placeholders) with an sr-only `กำลังโหลด…`.

## 9. Server vs client components

Server by default (CLAUDE.md). `'use client'` requires justification and is
earned only by:

1. form state / `useTransition` / `router.refresh`
2. navigation hooks (`usePathname` for active tabs)
3. keyboard or window event listeners (Escape, document-level)
4. IndexedDB / localStorage / Service Worker access
5. open/close/focus view state

Pages, layouts, AppHeader, HubNav, StatusPill, notices, and skeletons are
all server components.

## 10. Hard floors — do not change without a spec

- PILL\_\* fills and `StatusPill` geometry; `status-colors.ts` mappings.
- Ink-on-white text floors (§3); `color-scheme: light`; theme `#ffffff`.
- 44 px touch targets.
- `text-blue-700` as the link convention; slate-900 as the action fill.
- The LINE login button; ConfirmDialog/lightbox scrims.
- `PAGE_MAX_W` and its three recorded exceptions.
- Locked behaviors (spec 14 checklist): pinned-form modes, back-nav
  targets, group-header semantics, progress-from-unfiltered, avatar
  precedence.

Several of these are pinned by named UPDATE-tests — a visual change that
moves a pinned class must update the test in the same unit, with the spec
naming the change.

## 11. Spec 67 doctrine deltas (2026-06-13) + anti-drift pins

- **Thai leading.** Wrapping headings carry explicit `leading-` (Latin-tuned
  defaults crowd stacked tone marks). `DETAIL_TITLE` = `leading-snug`.
- **Token canon (amends §3).** Positive/done = **emerald**; current/in-progress
  = **amber**; `blue-700` stays links/active-nav ONLY (never a fill). No
  off-palette `green-*` anywhere.
- **Segmented controls / radios** use the shared `RadioChip`
  ([radio-chip.tsx](../src/components/features/radio-chip.tsx)) — a native
  `sr-only` radio (keyboard + SR from the browser), 44px. A `role="radio"` on a
  `<button>` is a review reject (it lies about keyboard support).
- **Destructive actions** use the shared `ConfirmActionButton`
  ([confirm-action-button.tsx](../src/components/features/confirm-action-button.tsx))
  or `ConfirmDialog`. `window.confirm` is a review reject (§7).
- **Anti-drift.** `tests/unit/design-doctrine.test.ts` reads `src/` and fails on
  recurrence: `window.confirm(`, off-palette `green-*`, `min-h-9`, group-header
  `truncate`, missing `DETAIL_TITLE` leading, the blue progress fill. The
  doctrine is now enforced by a test, not by one operator's eye.

===== FILE: src/app/globals.css =====

@import "tailwindcss";

@custom-variant dark (&:is(.dark \*));

/_ ------------------------------------------------------------------ _/
/_ shadcn primitive tokens — UNCHANGED. The ui/_ primitives _/
/_ (input/textarea/skeleton) still reference these until retired. _/
/_ The app's own theme lives in the PRC OPS block below. _/
/_ ------------------------------------------------------------------ \*/
@theme inline {
--color-background: var(--background);
--color-foreground: var(--foreground);
--color-card: var(--card);
--color-card-foreground: var(--card-foreground);
--color-popover: var(--popover);
--color-popover-foreground: var(--popover-foreground);
--color-primary: var(--primary);
--color-primary-foreground: var(--primary-foreground);
--color-secondary: var(--secondary);
--color-secondary-foreground: var(--secondary-foreground);
--color-muted: var(--muted);
--color-muted-foreground: var(--muted-foreground);
--color-accent: var(--accent);
--color-accent-foreground: var(--accent-foreground);
--color-destructive: var(--destructive);
--color-destructive-foreground: var(--destructive-foreground);
--color-border: var(--border);
--color-input: var(--input);
--color-ring: var(--ring);
--radius-sm: calc(var(--radius) - 4px);
--radius-md: calc(var(--radius) - 2px);
--radius-lg: var(--radius);
--radius-xl: calc(var(--radius) + 4px);
--font-sans: var(--font-sarabun);
--font-mono: var(--font-geist-mono);
}

:root {
--radius: 0.625rem;
--background: oklch(1 0 0);
--foreground: oklch(0.145 0 0);
--card: oklch(1 0 0);
--card-foreground: oklch(0.145 0 0);
--popover: oklch(1 0 0);
--popover-foreground: oklch(0.145 0 0);
--primary: oklch(0.205 0 0);
--primary-foreground: oklch(0.985 0 0);
--secondary: oklch(0.97 0 0);
--secondary-foreground: oklch(0.205 0 0);
--muted: oklch(0.97 0 0);
--muted-foreground: oklch(0.556 0 0);
--accent: oklch(0.97 0 0);
--accent-foreground: oklch(0.205 0 0);
--destructive: oklch(0.577 0.245 27.325);
--destructive-foreground: oklch(0.985 0 0);
--border: oklch(0.922 0 0);
--input: oklch(0.922 0 0);
--ring: oklch(0.708 0 0);
}

/_ ================================================================== _/
/_ PRC OPS — FIELD-FIRST DESIGN TOKENS (Unit 1, revised) _/
/\* _/
/_ THE single source of truth. Worklist triage, the shutter sheet, _/
/_ the nameplate, every surface/ink/status/radius/shadow/type _/
/_ decision resolves here. Components consume token utilities _/
/_ (bg-card, text-ink, rounded-card, shadow-up, text-display, …) — _/
/_ never a raw Tailwind color literal. Re-theming = editing THIS _/
/_ block (e.g. a future night-shift palette overrides :root). _/
/_ _/
/_ Sun floors (spec 20) preserved; ratios noted vs. the surface the _/
/_ token sits on. _/
/_ ================================================================== _/
@theme {
/_ --- Surfaces ---------------------------------------------------- _/
--color-page: oklch(0.962 0.003 247); /_ ≈ #eef0f3 cool ground — cards read as figure _/
--color-card: oklch(1 0 0); /_ #ffffff — max sun emission _/
--color-sunk: oklch(0.968 0.002 247); /_ ≈ #f1f3f5 inset rows / sub-panels _/
--color-edge: oklch(0.92 0.003 247); /_ ≈ #e3e5e9 card hairline _/
--color-edge-strong: oklch(
0.69 0.008 256
); /_ ≈ #9aa0aa field/control border — WCAG 1.4.11 ≥3:1 \*/

/_ --- Ink (spec 20 floors) --------------------------------------- _/
--color-ink: oklch(0.2 0.006 264); /_ ≈ #15161a ~16:1 on card _/
--color-ink-secondary: oklch(0.43 0.01 264); /_ ≈ #4b4f57 ~7.4:1 on card _/
--color-ink-muted: oklch(0.69 0.008 256); /_ ≈ #9aa0aa dividers / placeholder / disabled ONLY _/

/_ --- Brand band (the one dark surface) -------------------------- _/
--color-brand: oklch(0.23 0.04 264); /_ ≈ #0f172a slate-900 — white ink ~17:1 _/
--color-brand-2: oklch(0.31 0.045 264); /_ ≈ #1e293b slate-800 _/
--color-on-brand: oklch(1 0 0);

/_ --- Action vs fill (EXCLUSIVE, spec 20) ------------------------ _/
--color-action: oklch(0.49 0.21 264); /_ ≈ #1d4ed8 blue-700 — links + active-nav ONLY _/
--color-fill: oklch(0.23 0.04 264); /_ ≈ #0f172a slate-900 — neutral primary fills _/
--color-fill-press: oklch(0.31 0.045 264); /_ ≈ #1e293b slate-800 _/
--color-on-fill: oklch(1 0 0);
--color-action-soft: oklch(0.97 0.02 255); /_ ≈ #eff6ff blue-50 — "ของฉัน"/selected ground _/

/_ --- Attention / signature amber (the field-action hue) --------- _/
--color-attn: oklch(0.77 0.16 70); /_ ≈ #f59e0b amber-500 — spines, capture, shutter _/
--color-attn-press: oklch(0.62 0.16 55); /_ ≈ #b4750b amber-700 — pressed/underside _/
--color-attn-soft: oklch(0.985 0.03 90); /_ ≈ #fff7e6 amber-50 — band/chip ground _/
--color-attn-edge: oklch(0.85 0.13 85); /_ ≈ #fcd34d amber-300 _/
--color-attn-ink: oklch(0.39 0.08 60); /_ ≈ #6b3a06 amber-900 — text on amber-soft ~7:1 _/
--color-on-attn: oklch(0.18 0.02 60); /_ ≈ #1a1205 near-black ink ON amber fill ~10:1 _/

/_ --- Waiting / review (sky — distinct from action-blue) --------- _/
--color-wait: oklch(0.5 0.13 245); /_ ≈ #0369a1 sky-800 — review spine/band _/
--color-wait-soft: oklch(0.97 0.02 240); /_ ≈ #eff8ff sky-50 _/
--color-wait-edge: oklch(0.82 0.1 235); /_ ≈ #7dd3fc sky-300 _/

/_ --- Done / positive (emerald canon — NEVER green-_) ------------ _/
--color-done: oklch(0.6 0.13 163); /_ ≈ #059669 emerald-600 _/
--color-done-strong: oklch(0.52 0.12 163); /_ ≈ #047857 emerald-700 — discs, white ink ~5.4:1 _/
--color-done-soft: oklch(0.97 0.03 165); /_ ≈ #ecfdf5 emerald-50 _/
--color-done-edge: oklch(0.85 0.13 163); /_ ≈ #6ee7b7 emerald-300 — soft success border _/
--color-done-ink: oklch(0.39 0.08 165); /_ ≈ #064e3b emerald-900 — text on done-soft \*/

/_ --- Danger ----------------------------------------------------- _/
--color-danger: oklch(0.58 0.22 27); /_ ≈ #dc2626 red-600 _/
--color-danger-strong: oklch(0.51 0.21 28); /_ ≈ #b91c1c red-700 — destructive hover/press _/
--color-danger-soft: oklch(0.97 0.015 17); /_ ≈ #fef2f2 red-50 _/
--color-danger-edge: oklch(0.8 0.1 20); /_ ≈ #fca5a5 red-300 _/
--color-danger-ink: oklch(0.4 0.13 25); /_ ≈ #7f1d1d red-900 _/

/_ --- Radii ------------------------------------------------------ _/
--radius-card: 1rem; /_ 16px → rounded-card (worklist rows, panels) _/
--radius-control: 0.75rem; /_ 12px → rounded-control (inputs/buttons/chips) _/
--radius-sheet: 1.5rem; /_ 24px → the shutter sheet top corners _/

/_ --- Elevation (defined shadows + kept hairline; sun-safe) ------ _/
--shadow-input: 0 1px 2px 0 rgb(16 24 40 / 0.05);
--shadow-card: 0 1px 2px 0 rgb(16 24 40 / 0.06), 0 1px 3px 0 rgb(16 24 40 / 0.1);
--shadow-up: 0 -6px 24px -8px rgb(16 24 40 / 0.18); /_ bottom-anchored capture bar _/
--shadow-pop: 0 12px 32px -8px rgb(16 24 40 / 0.28); /_ the shutter sheet _/

/_ --- Type ramp (Sarabun; Thai-tuned leading baked into each step _/
/_ so stacked tone marks never crowd — spec 67 made systemic) - _/
--text-display: 1.75rem; /_ WP / project nameplate — the hero _/
--text-display--line-height: 2.125rem;
--text-display--font-weight: 800;
--text-title: 1.375rem; /_ secondary titles _/
--text-title--line-height: 1.8rem;
--text-title--font-weight: 700;
--text-heading: 1.125rem; /_ card / block headings _/
--text-heading--line-height: 1.6rem;
--text-heading--font-weight: 700;
--text-section: 1rem; /_ zone / band heading _/
--text-section--line-height: 1.5rem;
--text-section--font-weight: 700;
--text-body: 0.9375rem; /_ body — 15px, comfortable outdoors _/
--text-body--line-height: 1.5rem;
--text-meta: 0.8125rem; /_ meta — 13px, the floor for real text _/
--text-meta--line-height: 1.2rem;
}

@layer base {

- {
  @apply border-border outline-ring/50;
  }
  html {
  /_ Spec 20: sun-mode light by design — opt out of force-dark. _/
  color-scheme: light;
  /_ Spec 77: kill the grey iOS tap-flash; our :active states win. _/
  -webkit-tap-highlight-color: transparent;
  }
  body {
  @apply bg-page text-ink;
  }
  /_ Spec 77: instant taps — drop the ~300ms double-tap-zoom delay. _/
  a,
  button,
  summary,
  label,
  [role="button"] {
  touch-action: manipulation;
  }
  }

/_ Spec 76 — toast enter. OPT-IN per prefers-reduced-motion. _/
@keyframes toast-in {
from {
opacity: 0;
transform: translateY(8px);
}
to {
opacity: 1;
transform: translateY(0);
}
}
@media (prefers-reduced-motion: no-preference) {
.toast-item {
animation: toast-in 180ms ease-out;
}
}

/_ Spec 78 — bottom-sheet / shutter-sheet slide-up. Base = motion-free. _/
@keyframes sheet-up {
from {
transform: translateY(100%);
}
to {
transform: translateY(0);
}
}
@media (prefers-reduced-motion: no-preference) {
.sheet-panel {
animation: sheet-up 220ms cubic-bezier(0.32, 0.72, 0, 1);
}
}

/_ Field-First — the shutter's idle "ready to capture" pulse. Decorative,
motion-OK only; the button is fully usable with motion off. _/
@keyframes shutter-pulse {
0%,
100% {
box-shadow:
0 0 0 3px var(--color-attn),
0 10px 24px -6px rgb(180 117 11 / 0.6);
}
50% {
box-shadow:
0 0 0 9px rgb(245 158 11 / 0.22),
0 10px 24px -6px rgb(180 117 11 / 0.6);
}
}
@media (prefers-reduced-motion: no-preference) {
.shutter-live {
animation: shutter-pulse 2.4s ease-in-out infinite;
}
}

===== FILE: src/lib/ui/classes.ts =====

// Canonical UI class constants — Field-First (Unit 1, revised).
//
// Components consume these; the constants consume token-generated
// utilities (bg-card, text-ink, rounded-control, shadow-card,
// text-body, …). A theme change is ONE file (globals.css). These
// strings carry NO raw color literals.
//
// Every value is byte-pinned in tests/unit/ui-classes-spec65.test.ts
// — those pins are UPDATED in this unit (test path (b): the design
// changes output, so the pins follow the design). Hand-rolling a copy
// of any shared primitive is a review reject (ui-conventions §5/§7).

/\*_ Slate-900 neutral primary fill (spec 40), token-driven. _/
export const BUTTON_PRIMARY =
"inline-flex h-11 items-center justify-center rounded-control bg-fill px-4 text-body font-semibold text-on-fill shadow-card transition-colors hover:bg-fill-press focus:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:bg-edge disabled:text-ink-muted";

/\*_ White outline sibling of BUTTON_PRIMARY. _/
export const BUTTON_SECONDARY =
"inline-flex h-11 items-center justify-center rounded-control border border-edge bg-card px-4 text-body font-semibold text-ink shadow-input transition-colors hover:bg-sunk focus:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:text-ink-muted";

/\*\*

- Field-First HERO action — the full-width amber capture bar. 64px so a
- gloved thumb cannot miss it; 2px amber underside reads as a physical
- key. The single most important control in the app.
  \*/
  export const BUTTON_CAPTURE =
  "inline-flex h-16 w-full items-center justify-center gap-3 rounded-card bg-attn text-lg font-extrabold text-on-attn shadow-card transition-[transform,background-color] hover:bg-attn-press hover:text-on-fill focus:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 active:translate-y-0.5";

/\*_ 44px white chip for header icon affordances (back/gear/reports). _/
export const ICON_CHIP =
"inline-flex h-11 w-11 items-center justify-center rounded-control border border-edge bg-card text-ink shadow-card transition-colors hover:bg-sunk active:bg-sunk active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-action";

/\*_ ICON_CHIP with muted ink for secondary header actions. _/
export const ICON_CHIP_MUTED =
"inline-flex h-11 w-11 items-center justify-center rounded-control border border-edge bg-card text-ink-secondary shadow-card transition-colors hover:bg-sunk hover:text-ink active:bg-sunk active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-action";

/\*_ Inline form/action error strip — pair with role="alert". _/
export const INLINE_ERROR =
"rounded-md border border-danger-edge bg-danger-soft px-3 py-2 text-meta text-danger-ink";

/\*_ Standard white card — defined corner + real elevation, hairline kept. _/
export const CARD = "rounded-card border border-edge bg-card px-4 py-3 shadow-card";

/\*_ Zone/section heading h2. _/
export const SECTION_HEADING = "mb-3 text-section font-semibold text-ink";

/\*\*

- Detail-page subject h1 (WP name, request item) — full wrap, never
- truncate (spec 54/57). Promoted to the `display` tier: WP identity is
- the page's unmistakable nameplate. `leading-snug` kept explicit — a
- Thai-only app needs the override or wrapped tone marks crowd (spec 67;
- design-doctrine pins a `leading-` class on this constant).
  \*/
  export const DETAIL_TITLE = "text-display leading-snug font-extrabold tracking-tight break-words";

/\*_ Standard h-11 text input. Field border = edge-strong (WCAG 1.4.11). _/
export const FIELD_INPUT =
"h-11 w-full min-w-0 rounded-control border border-edge-strong bg-card px-3 text-body text-ink shadow-input placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-action";

/\*_ Standard h-11 select (px-2 sibling of FIELD_INPUT). _/
export const FIELD_SELECT =
"h-11 w-full min-w-0 rounded-control border border-edge-strong bg-card px-2 text-body text-ink shadow-input focus:outline-none focus-visible:ring-2 focus-visible:ring-action";

/\*_ Stacked label+field input used by the labor components (py-2, mt-1). _/
export const FIELD_STACKED =
"mt-1 w-full rounded-control border border-edge-strong bg-card px-3 py-2 text-body text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-action";

/\*_ min-h-11 primary fill, the labor-feature compact pair. _/
export const BUTTON_PRIMARY_COMPACT =
"inline-flex min-h-11 items-center justify-center rounded-control bg-fill px-4 py-2 text-body font-medium text-on-fill shadow-input transition-colors hover:bg-fill-press active:translate-y-px disabled:opacity-50";

/\*_ min-h-11 outline sibling of BUTTON_PRIMARY_COMPACT. _/
export const BUTTON_SECONDARY_COMPACT =
"inline-flex min-h-11 items-center justify-center rounded-control border border-edge bg-card px-4 py-2 text-body font-medium text-ink-secondary transition-colors hover:bg-sunk";

/\*_ Muted secondary used by the photo uploaders. _/
export const BUTTON_SECONDARY_MUTED =
"inline-flex h-11 items-center justify-center rounded-control border border-edge bg-card px-3 text-body font-medium text-ink shadow-input transition-colors hover:bg-sunk focus:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:cursor-not-allowed disabled:opacity-60";

/\*_ Borderless inline alert text — pair with role="alert". _/
export const INLINE_ALERT_TEXT = "text-meta font-medium text-danger";

/\*_ Full-width error banner (login surfaces) — pair with role="alert". _/
export const BANNER_ERROR =
"rounded border border-danger-edge bg-danger-soft px-4 py-3 text-body text-danger-ink";

/\*\*

- RESERVED critical-path badge (Field-First). Driven by `isCritical`
- (the future critical-path engine — false for every WP today, so this
- renders nowhere yet). Pinned now so the slot is style-stable when the
- engine lights it. High-vis red fill, white ink — readable at arm's
- length in glare.
  \*/
  export const CRITICAL_BADGE =
  "inline-flex items-center gap-1 rounded-full border border-danger-ink bg-danger px-2 py-0.5 text-meta font-extrabold text-on-fill";

// ---------------------------------------------------------------------------
// Spec 76 — toast colour trios. emerald is the sanctioned positive hue
// (NEVER green-\* — design-doctrine test). Token-rewired.
// ---------------------------------------------------------------------------

/\*_ Success toast colours — the done (emerald) trio. _/
export const TOAST_SUCCESS = "border-done bg-done/10 text-done-strong";

/\*_ Error toast colours — the danger (red) trio. _/
export const TOAST_ERROR = "border-danger-edge bg-danger-soft text-danger-ink";

===== FILE: src/lib/work-packages/action-bands.ts =====

// Field-First action-state lens — pure helpers over the WP list props.
//
// The operator's real question on the worklist is "what needs MY action
// right now?". This maps each WP's status to an ACTION BAND and orders
// the actionable band by the supplied universal priority rank, so every
// role sees the highest-leverage work first.
//
// PURE: no fetch, no compute of priority. `priorityRank` / `isCritical`
// are SUPPLIED by the data layer (a separate priority-engine spec owns
// the derivation + migration). This module only consumes and orders.
//
// WP status enum (SDD §2.4): not_started → in_progress → pending_approval
// → complete, plus on_hold (manual). needs_revision/rejected are approval
// decisions, not statuses — a returned WP sits at pending_approval, so it
// correctly lands in the "review" band until the SA re-captures (which
// flips it back through the normal transition).

import type { Database } from "@/lib/db/database.types";

export type WorkPackageStatus = Database["public"]["Enums"]["work_package_status"];

/\*_ Manual operator-set urgency flag (data layer supplies it). _/
export type WpPriority = "normal" | "urgent" | "critical";

/\*_ Action bands, in render order. _/
export type ActionBand = "todo" | "held" | "review" | "done";

export const ACTION_BAND_ORDER: readonly ActionBand[] = ["todo", "held", "review", "done"];

interface BandMeta {
/** Thai band heading, arm's-length legible. \*/
label: string;
/** Token spine colour utility for rows in this band. _/
spine: string;
/\*\* Token count-pill background utility. _/
countBg: string;
/\*_ Done band collapses to a summary row by default. _/
collapsible: boolean;
}

export const ACTION_BAND_META: Record<ActionBand, BandMeta> = {
todo: { label: "ต้องทำเลย", spine: "bg-attn", countBg: "bg-attn-press", collapsible: false },
held: {
label: "พักงานชั่วคราว",
spine: "bg-ink-muted",
countBg: "bg-ink-secondary",
collapsible: false,
},
review: { label: "รอ PM ตรวจ", spine: "bg-wait", countBg: "bg-wait", collapsible: false },
done: { label: "เสร็จแล้ว", spine: "bg-done", countBg: "bg-done-strong", collapsible: true },
};

export function deriveActionBand(status: WorkPackageStatus): ActionBand {
switch (status) {
case "not_started":
case "in_progress":
return "todo";
case "on_hold":
return "held";
case "pending_approval":
return "review";
case "complete":
return "done";
default:
// Unknown future status — surface it where it can't be silently
// lost: the actionable band.
return "todo";
}
}

/\*\* What the row's next-action verb is asking the operator to do. The row

- maps kind → icon (assign = person, capture = camera, wait = paused). \*/
  export type NextActionKind = "assign" | "capture" | "wait";

export interface NextAction {
label: string;
kind: NextActionKind;
}

/\*\*

- The precise next step for an actionable WP, factoring in whether a
- contractor is assigned. A not_started WP with no owner needs assignment
- BEFORE any photo makes sense — surfacing "take photos" there would be a
- dead end. The row still links to the WP, where the action actually
- happens; this just names it honestly at the list level.
- Returns null for bands with no single row-level action (review, done).
  \*/
  export function nextAction(status: WorkPackageStatus, hasContractor: boolean): NextAction | null {
  switch (status) {
  case "not_started":
  return hasContractor
  ? { label: "เริ่มถ่ายรูป เตรียมงาน", kind: "capture" }
  : { label: "มอบหมายผู้รับเหมา", kind: "assign" };
  case "in_progress":
  return { label: "ถ่ายรูป ความคืบหน้า", kind: "capture" };
  case "on_hold":
  return { label: "พักงานอยู่ — รอปลดล็อก", kind: "wait" };
  default:
  return null;
  }
  }

/\*\*

- Map the manual priority flag to a sort rank — higher sorts first in the
- ต้องทำ band (byPriorityRank desc). This is the L0 alignment rank; a later
- critical-path engine can fold its own signal in on top.
  \*/
  export function rankFromPriority(priority: WpPriority): number {
  switch (priority) {
  case "critical":
  return 2;
  case "urgent":
  return 1;
  default:
  return 0;
  }
  }

export interface BandableWp {
status: WorkPackageStatus;
/\*_ Universal cross-role rank (data layer supplies it). Higher = first. _/
priorityRank: number;
}

/\*\*

- Stable sort by priorityRank desc, preserving the incoming order
- (already code-ascending from the page query) for ties. The lever that
- aligns every role on the same highest-leverage work first.
  \*/
  export function byPriorityRank<T extends BandableWp>(items: readonly T[]): T[] {
  return items
  .map((item, index) => ({ item, index }))
  .sort((a, b) => b.item.priorityRank - a.item.priorityRank || a.index - b.index)
  .map(({ item }) => item);
  }

/\*_ Group an already-sorted list into bands, dropping empty bands. _/
export function groupByActionBand<T extends BandableWp>(
items: readonly T[],
): Array<{ band: ActionBand; items: T[] }> {
const buckets = new Map<ActionBand, T[]>();
for (const item of items) {
const band = deriveActionBand(item.status);
const bucket = buckets.get(band) ?? [];
bucket.push(item);
buckets.set(band, bucket);
}
return ACTION_BAND_ORDER.flatMap((band) => {
const bucket = buckets.get(band);
if (!bucket || bucket.length === 0) return [];
return [{ band, items: byPriorityRank(bucket) }];
});
}

===== FILE: src/lib/work-packages/critical-path.ts =====

// Spec 92 Unit B — critical-path computation (pure). Given WPs with planned
// windows + finish-to-start dependencies, return the set of WP ids on the
// critical path: the longest dependency chain (by planned duration) whose slip
// slips the project finish. A WP is critical when its total float is zero.
//
// Pure + deterministic (Date.parse on ISO dates only) so it unit-tests cleanly
// and runs server-side per project (~80 WPs — trivial). is_critical is computed
// on read, never stored (spec 92 data model).

export interface ScheduledWp {
id: string;
/\*_ ISO date (YYYY-MM-DD) or null when unscheduled. _/
plannedStart: string | null;
plannedEnd: string | null;
}

export interface DependencyEdge {
predecessorId: string;
successorId: string;
}

const DAY_MS = 86_400_000;

function durationDays(start: string | null, end: string | null): number {
if (!start || !end) return 0;
const ms = Date.parse(end) - Date.parse(start);
if (Number.isNaN(ms) || ms < 0) return 0;
return Math.round(ms / DAY_MS);
}

/\*_ Kahn topological order; null if the graph has a cycle. _/
function topoOrder(
ids: readonly string[],
succs: Map<string, string[]>,
preds: Map<string, string[]>,
): string[] | null {
const indeg = new Map<string, number>();
for (const id of ids) indeg.set(id, preds.get(id)?.length ?? 0);
const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
const order: string[] = [];
while (queue.length > 0) {
const id = queue.shift() as string;
order.push(id);
for (const s of succs.get(id) ?? []) {
const d = (indeg.get(s) ?? 0) - 1;
indeg.set(s, d);
if (d === 0) queue.push(s);
}
}
return order.length === ids.length ? order : null;
}

/\*\*

- Returns the set of WP ids on the critical path. Empty when there are no
- dependencies (no precedence structure to derive a path from) or when a cycle
- is present (defensive — the add RPC already rejects cycles).
  \*/
  export function criticalWorkPackageIds(
  items: readonly ScheduledWp[],
  edges: readonly DependencyEdge[],
  ): Set<string> {
  if (edges.length === 0) return new Set();

const ids = items.map((w) => w.id);
const idSet = new Set(ids);
const dur = new Map<string, number>();
for (const w of items) dur.set(w.id, durationDays(w.plannedStart, w.plannedEnd));

const preds = new Map<string, string[]>();
const succs = new Map<string, string[]>();
for (const id of ids) {
preds.set(id, []);
succs.set(id, []);
}
const onEdge = new Set<string>();
for (const e of edges) {
if (!idSet.has(e.predecessorId) || !idSet.has(e.successorId)) continue;
succs.get(e.predecessorId)?.push(e.successorId);
preds.get(e.successorId)?.push(e.predecessorId);
onEdge.add(e.predecessorId);
onEdge.add(e.successorId);
}

const order = topoOrder(ids, succs, preds);
if (!order) return new Set();

// Forward pass — earliest finish.
const ef = new Map<string, number>();
for (const id of order) {
const ps = preds.get(id) ?? [];
const earliestStart = ps.length ? Math.max(...ps.map((p) => ef.get(p) ?? 0)) : 0;
ef.set(id, earliestStart + (dur.get(id) ?? 0));
}
const projectEnd = ids.reduce((m, id) => Math.max(m, ef.get(id) ?? 0), 0);

// Backward pass — latest finish.
const lf = new Map<string, number>();
for (const id of [...order].reverse()) {
const ss = succs.get(id) ?? [];
lf.set(
id,
ss.length
? Math.min(...ss.map((s) => (lf.get(s) ?? projectEnd) - (dur.get(s) ?? 0)))
: projectEnd,
);
}

// Critical = zero total float, on an actual edge, with real duration.
const critical = new Set<string>();
for (const id of ids) {
const floatDays = (lf.get(id) ?? 0) - (ef.get(id) ?? 0);
if (floatDays === 0 && onEdge.has(id) && (dur.get(id) ?? 0) > 0) critical.add(id);
}
return critical;
}

===== FILE: src/lib/status-colors.ts =====

// Shared status-color helper for the SA-side pills (project list, WP
// list). The palette here matches the PM-side pills already in use on
// - src/app/review/page.tsx (approval-decision pill)
// - src/app/projects/[projectId]/reports/reports-list.tsx (report
// status pill)
// - src/app/review/work-packages/[workPackageId]/page.tsx (decision-
// history pill)
//
// Same four palette slots, picked to keep the whole app visually
// consistent without restyling the PM pills in this PR:
//
// zinc — neutral / idle / default
// amber — in-flight / needs attention
// emerald — positive terminal (done, completed, success)
// muted — closed / hidden / archived (zinc, but dimmer text)
//
// The helpers are pure / typed / exhaustive on the enum unions. The
// exhaustiveness check (the `_exhaustive: never` assignment at the end
// of each switch) means adding a new enum value to the database will
// cause a TypeScript error here — exactly the place to update the map.

import type {
ApprovalDecision,
ProjectStatus,
PurchaseRequestPriority,
PurchaseRequestStatus,
ReportStatus,
WorkPackageStatus,
} from "@/lib/db/enums";

export type {
ApprovalDecision,
ProjectStatus,
PurchaseRequestPriority,
PurchaseRequestStatus,
ReportStatus,
WorkPackageStatus,
};

// Spec 20 sun palette: solid saturated fills, not dark translucent
// tints — a pill must be identifiable by hue at arm's length in glare.
// Amber carries ink text (white-on-amber fails contrast); emerald/red
// carry white text on 600-weight fills.
const PILL_ZINC = "border-zinc-400 bg-zinc-200 text-zinc-900";
const PILL_AMBER = "border-amber-600 bg-amber-400 text-zinc-950";
// emerald-700 fill: white-on-emerald-600 is 3.67:1 (AA fail); 700 gives
// 5.37:1 (AA pass) while keeping the positive hue identifiable.
const PILL_EMERALD = "border-emerald-800 bg-emerald-700 text-white";
const PILL_RED = "border-red-700 bg-red-600 text-white";
// sky-700 fill: white-on-sky-600 is ~3.7:1 (AA fail); 700 passes while
// staying clearly "in transit" blue, distinct from the blue-700 action hue.
const PILL_SKY = "border-sky-800 bg-sky-700 text-white";
const PILL_MUTED = "border-zinc-300 bg-zinc-100 text-zinc-600";

export function projectStatusPillClasses(status: ProjectStatus): string {
switch (status) {
case "active":
// Default resting state. Most projects sit here; using zinc keeps
// the project list calm instead of every row screaming "look at me."
return PILL_ZINC;
case "on_hold":
// Paused, needs human decision to resume — amber to signal that.
return PILL_AMBER;
case "completed":
// Positive terminal — same emerald as the WP `complete` and the
// report `ready` pill on the PM side.
return PILL_EMERALD;
case "archived":
// Closed / hidden from active work. Muted so it visibly drops
// back from active rows.
return PILL_MUTED;
default: {
// Exhaustiveness check + defensive runtime fallback for any
// future enum value that lands before this file is updated.
const \_exhaustive: never = status;
void \_exhaustive;
return PILL_ZINC;
}
}
}

// Latest-decision pill on the PM queue and the decision-history pill on
// the review screen. null = no decision yet (awaiting first review).
export function approvalDecisionPillClasses(decision: ApprovalDecision | null): string {
switch (decision) {
case "approved":
return PILL_EMERALD;
case "rejected":
return PILL_RED;
case "needs_revision":
return PILL_AMBER;
case null:
// Awaiting first review — idle default.
return PILL_ZINC;
default: {
const \_exhaustive: never = decision;
void \_exhaustive;
return PILL_ZINC;
}
}
}

export function reportStatusPillClasses(status: ReportStatus): string {
switch (status) {
case "requested":
// Queued, worker hasn't picked it up — idle default.
return PILL_ZINC;
case "processing":
// Worker is generating the PDF — in flight.
return PILL_AMBER;
case "complete":
return PILL_EMERALD;
case "failed":
return PILL_RED;
default: {
const \_exhaustive: never = status;
void \_exhaustive;
return PILL_ZINC;
}
}
}

// Requester-set urgency (spec 16). normal renders no pill on the cards
// (the quiet default — only escalations draw the eye); the map still
// covers it for completeness and the fallback path.
export function purchaseRequestPriorityPillClasses(priority: PurchaseRequestPriority): string {
switch (priority) {
case "normal":
return PILL_ZINC;
case "urgent":
return PILL_AMBER;
case "critical":
return PILL_RED;
default: {
const \_exhaustive: never = priority;
void \_exhaustive;
return PILL_ZINC;
}
}
}

export function purchaseRequestStatusPillClasses(status: PurchaseRequestStatus): string {
switch (status) {
case "requested":
// Idle default — sitting in the PM's queue, same zinc as
// `not_started` on the WP side.
return PILL_ZINC;
case "approved":
// Positive: the PM said yes; procurement takes over from here.
return PILL_EMERALD;
case "rejected":
// Negative terminal — the only red pill in the purchasing flow.
// The rejection comment block on /requests explains why.
return PILL_RED;
case "cancelled":
// Administrative close (ADR 0031) — muted like archived projects,
// not red: nothing was refused, the need simply went away.
return PILL_MUTED;
case "purchased":
// In flight with the back office (AppSheet) — goods ordered but
// not yet on site. Amber, like the in-flight WP statuses.
return PILL_AMBER;
case "on_route":
// Goods physically moving (shipped_at set by the back office,
// ADR 0027). Sky — between amber "ordered" and emerald "received".
return PILL_SKY;
case "delivered":
// Positive terminal — goods received on site.
return PILL_EMERALD;
case "site_purchased":
// On-site cash purchase (ADR 0043) — goods already on site; a
// positive terminal like delivered. The source='site_purchase' +
// acknowledged_at badge carries the "awaiting PM acknowledgement"
// signal separately, so the pill stays a clean terminal hue.
return PILL_EMERALD;
default: {
const \_exhaustive: never = status;
void \_exhaustive;
return PILL_ZINC;
}
}
}

export function workPackageStatusPillClasses(status: WorkPackageStatus): string {
switch (status) {
case "not_started":
// Idle default — same zinc as the PM-side `requested` pill.
return PILL_ZINC;
case "in_progress":
case "on_hold":
case "pending_approval":
// All three are "in flight" from the SA's perspective: work is
// happening, paused, or with the PM. Amber across the board;
// the pill text label is what tells them apart precisely. Same
// amber the PM side uses for `processing` / `needs_revision`.
return PILL_AMBER;
case "complete":
// Positive terminal — same emerald as PM `complete` report.
return PILL_EMERALD;
default: {
const \_exhaustive: never = status;
void \_exhaustive;
return PILL_ZINC;
}
}
}

===== FILE: src/components/features/status-pill.tsx =====

// StatusPill (spec 20): the app's status semantics carrier. The colour
// TRIO (hue) comes from status-colors.ts and is FROZEN — it encodes
// meaning. Field-First changes only the GEOMETRY (the pixels): bolder
// 1.5px border, a touch more weight, so the fill reads at arm's length
// in glare. Semantics untouched; this is a pure re-skin of the wrapper.

interface StatusPillProps {
/\*_ Frozen colour trio from status-colors.ts (bg/border/text). _/
pillClasses: string;
className?: string;
children: React.ReactNode;
}

export function StatusPill({ pillClasses, className, children }: StatusPillProps) {
return (
<span
className={`text-meta inline-flex shrink-0 items-center rounded-full border-[1.5px] px-2.5 py-1 leading-none font-bold whitespace-nowrap ${pillClasses}${
        className ? ` ${className}` : ""
      }`} >
{children}
</span>
);
}

===== FILE: src/components/features/page-shell.tsx =====

// PageShell (spec 64): THE page scroller. The body is locked
// (h-full overflow-hidden in the root layout); this <main> is the only
// thing that scrolls. Sticky headers stick to it crisply on iOS, and
// fixed chrome (tab bar, queue banner, scrims) anchors a viewport that
// can no longer rubber-band — drift is impossible by construction.
//
// Spec-63 consolidation rule: every route renders PageShell;
// hand-rolling a <main> is a review reject (ui-conventions §5).

type PageShellVariant = "app" | "card" | "bare";

const SHELL_BASE = "h-full overflow-y-auto overscroll-y-contain text-ink";

const VARIANT_CLASSES: Record<PageShellVariant, string> = {
/** Content pages: zinc wash + phone tab-bar clearance. \*/
app: "bg-page pb-20 sm:pb-0",
/** Single-card screens (login, landing, error, not-found). _/
card: "flex items-center justify-center bg-card px-6",
/\*\* Caller supplies the rest (profile, coming-soon hub). _/
bare: "",
};

interface PageShellProps {
variant?: PageShellVariant;
className?: string;
children: React.ReactNode;
}

export function PageShell({ variant = "app", className, children }: PageShellProps) {
return (
<main className={`${SHELL_BASE} ${VARIANT_CLASSES[variant]} ${className ?? ""}`.trim()}>
{children}
</main>
);
}

===== FILE: src/components/features/detail-header.tsx =====

// DetailHeader (spec 63): THE sticky detail-header shell — back chip,
// refresh, optional action chips, the nameplate block as children.
// Field-First: token-rewired (border-edge / bg-card), structure +
// behavior unchanged. The nameplate (children) carries the WP/subject
// identity at the display tier — see DETAIL_TITLE.
// Server component; only RefreshButton inside is client.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { ICON_CHIP } from "@/lib/ui/classes";
import { RefreshButton } from "@/components/features/refresh-button";

interface DetailHeaderProps {
backHref: string;
backLabel: string;
/** Extra header chips (gear, reports, …) rendered left of refresh. \*/
actions?: React.ReactNode;
/** The nameplate block: code line, h1, meta lines. \*/
children: React.ReactNode;
}

export function DetailHeader({ backHref, backLabel, actions, children }: DetailHeaderProps) {
return (
// Spec 62 z-stack: headers 20 < queue banner 30 < tab bar 40 < scrims 50.
<header className="border-edge bg-card sticky top-0 z-20 border-b px-5 py-4">
<div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-3`}>
<div className="flex items-center justify-between gap-3">
<Link href={backHref} aria-label={backLabel} className={ICON_CHIP}>
<ArrowLeft aria-hidden className="h-5 w-5" />
</Link>
<div className="flex items-center gap-2">
{actions}
{/_ Spec 53: the PWA's only reload affordance. _/}
<RefreshButton variant="light" />
</div>
</div>
{children}
</div>
</header>
);
}

===== FILE: src/components/features/worklist-row.tsx =====

// WorklistRow (Field-First): the action-state row. The WHOLE row is one
// Link to the WP detail (single-anchor pattern preserved from spec 47),
// where the thumb-anchored capture bar lives. A coloured status spine
// encodes the action band at arm's length; the precise status pill
// carries semantics (frozen); a status-level next-action hint tells the
// operator what the tap is for; the deliverable rides as a demoted tag.
//
// Priority surfaces two ways, by design:
// • `priority` (manual urgency flag) → a "ด่วน" tag, may be lit today.
// • `isCritical` (the future critical-path engine) → the RESERVED
// CRITICAL_BADGE. False for every WP now, so it renders nowhere yet —
// the slot exists and is style-pinned for when the engine lights it.

import Link from "next/link";
import { ChevronRight, Camera, UserPlus, PauseCircle, AlertTriangle, Flame } from "lucide-react";
import { workPackageHref } from "@/lib/nav/project-paths";
import { StatusPill } from "@/components/features/status-pill";
import { CRITICAL_BADGE } from "@/lib/ui/classes";
import { WORK_PACKAGE_STATUS_LABEL } from "@/lib/i18n/labels";
import { workPackageStatusPillClasses } from "@/lib/status-colors";
import {
nextAction,
type NextActionKind,
type WorkPackageStatus,
type WpPriority,
} from "@/lib/work-packages/action-bands";

// next-action verb → its icon. assign = bring a contractor on; capture =
// shoot photos; wait = held, nothing to do now.
const ACTION_ICON: Record<NextActionKind, typeof Camera> = {
assign: UserPlus,
capture: Camera,
wait: PauseCircle,
};

export interface WorklistRowItem {
id: string;
code: string;
name: string;
status: WorkPackageStatus;
/** Whether a contractor is assigned — drives the next-action verb. \*/
hasContractor: boolean;
/** Manual urgency flag (data layer supplies it). _/
priority: WpPriority;
/\*\* Critical-path flag (future engine; false for all today). _/
isCritical: boolean;
/\*_ Demoted deliverable label, or null in flat / ungrouped mode. _/
deliverableLabel: string | null;
}

interface WorklistRowProps {
projectId: string;
wp: WorklistRowItem;
/** Token spine colour utility for this row's band. \*/
spine: string;
/** Compact density for the review/done bands (one-line name). \*/
compact?: boolean;
}

export function WorklistRow({ projectId, wp, spine, compact = false }: WorklistRowProps) {
const action = compact ? null : nextAction(wp.status, wp.hasContractor);
const ActionIcon = action ? ACTION_ICON[action.kind] : null;
const showUrgent = wp.priority === "urgent" || wp.priority === "critical";
return (
<Link
href={workPackageHref(projectId, wp.id)}
className="rounded-card border-edge bg-card shadow-card hover:bg-sunk focus-visible:ring-action active:bg-sunk flex items-stretch gap-0 overflow-hidden border transition-colors focus:outline-none focus-visible:ring-2" >
{/_ Action-band spine — the arm's-length status cue. _/}
<span aria-hidden="true" className={`w-[7px] shrink-0 ${spine}`} />
<span className="flex min-w-0 flex-1 flex-col gap-1.5 py-3 pr-1 pl-3">
{/_ Critical badge (reserved) + urgent tag ride above the name so
they're the first thing scanned when lit. _/}
{(wp.isCritical || showUrgent) && (
<span className="flex flex-wrap items-center gap-1.5">
{wp.isCritical && (
<span className={CRITICAL_BADGE}>
<Flame aria-hidden className="h-3 w-3" />
วิกฤต
</span>
)}
{showUrgent && (
<span className="border-attn-edge bg-attn-soft text-meta text-attn-ink inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold">
<AlertTriangle aria-hidden className="h-3 w-3" />
ด่วน
</span>
)}
</span>
)}
<span
className={`text-ink font-semibold break-words ${
            compact ? "text-body line-clamp-1" : "text-body line-clamp-2"
          }`} >
{wp.name}
</span>
{action && ActionIcon && (
<span className="text-meta text-attn-ink flex items-center gap-1.5 font-bold">
<ActionIcon aria-hidden className="text-attn-press h-4 w-4" />
{action.label}
</span>
)}
<span className="text-meta text-ink-secondary flex flex-wrap items-center gap-2">
{wp.deliverableLabel && (
<span className="border-edge bg-sunk rounded-md border px-1.5 py-0.5 font-semibold">
{wp.deliverableLabel}
</span>
)}
<span className="font-mono">{wp.code}</span>
</span>
</span>
<span className="flex shrink-0 flex-col items-end justify-center gap-1 py-3 pr-2 pl-1">
<StatusPill pillClasses={workPackageStatusPillClasses(wp.status)}>
{WORK_PACKAGE_STATUS_LABEL[wp.status] ?? wp.status}
</StatusPill>
</span>
<span aria-hidden="true" className="text-ink-muted flex items-center pr-2">
<ChevronRight className="h-5 w-5" />
</span>
</Link>
);
}

===== FILE: src/app/projects/[projectId]/page.tsx =====

import { PageShell } from "@/components/features/page-shell";
import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { FileText, Settings } from "lucide-react";
import { SITE_STAFF_ROLES } from "@/lib/auth/role-home";
import { projectSettingsHref, reportsHref } from "@/lib/nav/project-paths";
import { ICON_CHIP_MUTED, SECTION_HEADING } from "@/lib/ui/classes";
import { DetailHeader } from "@/components/features/detail-header";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { PROJECT_TYPE_LABEL } from "@/lib/projects/validate-settings";
import { rankFromPriority } from "@/lib/work-packages/action-bands";
import { criticalWorkPackageIds } from "@/lib/work-packages/critical-path";
import { WorkPackageList } from "./work-package-list";

interface PageProps {
params: Promise<{ projectId: string }>;
}

export const metadata = { title: "รายการงาน" };

export default async function ProjectWorkPackagesPage({ params }: PageProps) {
const { projectId } = await params;
const ctx = await requireRole(SITE_STAFF_ROLES);
const supabase = await createClient();

const { data: project } = await supabase
.from("projects")
.select("id, code, name, site_address, client_id, project_lead_id, project_type")
.eq("id", projectId)
.maybeSingle();

if (!project) {
notFound();
}

// Spec 79: project-context lines (client name, internal lead, type, site).
// budget is intentionally NOT read here (money — admin-only, PM screens).
const [clientRow, { data: memberRows }] = await Promise.all([
project.client_id
? supabase.from("clients").select("name").eq("id", project.client_id).maybeSingle()
: Promise.resolve({ data: null }),
supabase.from("project_members").select("user_id").eq("project_id", project.id),
]);
const clientName = clientRow.data?.name ?? null;
const memberIds = (memberRows ?? []).map((m) => m.user_id);
const nameIds = [
...new Set([...(project.project_lead_id ? [project.project_lead_id] : []), ...memberIds]),
];
const names = nameIds.length
? await fetchDisplayNames(nameIds, "[project-page]")
: new Map<string, string>();
const leadName = project.project_lead_id ? (names.get(project.project_lead_id) ?? null) : null;
const memberNames = memberIds
.map((id) => names.get(id) ?? null)
.filter((n): n is string => n !== null);
const typeLabel = project.project_type ? PROJECT_TYPE_LABEL[project.project_type] : null;

// Field-First worklist: action bands derive from `status`; the manual
// `priority` flag (spec 91) drives the ด่วน tag + ต้องทำ sort; `isCritical`
// is computed below from the schedule + dependencies (spec 92).
const { data: workPackages } = await supabase
.from("work_packages")
.select(
"id, code, name, status, deliverable_id, contractor_id, priority, planned_start, planned_end",
)
.eq("project_id", project.id)
.order("code", { ascending: true });

const { data: deliverables } = await supabase
.from("deliverables")
.select("id, code, name, sort_order")
.eq("project_id", project.id)
.order("sort_order", { ascending: true });

// Spec 92: critical path computed on read from planned windows + finish-to-
// start dependencies. Lights the worklist CRITICAL_BADGE for path WPs.
const wpIds = (workPackages ?? []).map((wp) => wp.id);
const { data: dependencyRows } = wpIds.length
? await supabase
.from("work_package_dependencies")
.select("predecessor_id, successor_id")
.in("predecessor_id", wpIds)
: { data: [] };
const criticalIds = criticalWorkPackageIds(
(workPackages ?? []).map((wp) => ({
id: wp.id,
plannedStart: wp.planned_start,
plannedEnd: wp.planned_end,
})),
(dependencyRows ?? []).map((d) => ({
predecessorId: d.predecessor_id,
successorId: d.successor_id,
})),
);

return (
<PageShell>
<BottomTabBar role={ctx.role} />
{/_ Spec 63 shell; spec 82: back goes to the folded /projects hub.
PM/super get reports + gear chips; SA never sees the gear. _/}
<DetailHeader
backHref="/projects"
backLabel="กลับไปโครงการ"
actions={
ctx.role === "project_manager" || ctx.role === "super_admin" ? (
<>
<Link
                href={reportsHref(project.id)}
                aria-label="รายงานโครงการ"
                className={ICON_CHIP_MUTED}
              >
<FileText aria-hidden className="h-5 w-5" />
</Link>
<Link
                href={projectSettingsHref(project.id)}
                aria-label="ตั้งค่าโครงการ"
                className={ICON_CHIP_MUTED}
              >
<Settings aria-hidden className="h-5 w-5" />
</Link>
</>
) : null
} >
<div>
<p className="text-meta text-ink-secondary font-mono">{project.code}</p>
<h1 className="text-title text-ink font-bold tracking-tight">{project.name}</h1>
{(clientName ||
leadName ||
memberNames.length > 0 ||
typeLabel ||
project.site_address) && (
<dl className="text-meta text-ink-secondary mt-1.5 flex flex-col gap-0.5">
{clientName && (
<div className="flex gap-1.5">
<dt>ลูกค้า:</dt>
<dd className="text-ink font-medium">{clientName}</dd>
</div>
)}
{leadName && (
<div className="flex gap-1.5">
<dt>ผู้รับผิดชอบ:</dt>
<dd className="text-ink font-medium">{leadName}</dd>
</div>
)}
{memberNames.length > 0 && (
<div className="flex gap-1.5">
<dt>ทีมงาน:</dt>
<dd className="text-ink font-medium break-words">{memberNames.join(", ")}</dd>
</div>
)}
{typeLabel && (
<div className="flex gap-1.5">
<dt>ประเภท:</dt>
<dd className="text-ink font-medium">{typeLabel}</dd>
</div>
)}
{project.site_address && (
<div className="flex gap-1.5">
<dt>ที่ตั้ง:</dt>
<dd className="text-ink font-medium break-words">{project.site_address}</dd>
</div>
)}
</dl>
)}
</div>
</DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <h2 className={SECTION_HEADING}>รายการงาน</h2>
        <WorkPackageList
          projectId={project.id}
          role={ctx.role}
          workPackages={(workPackages ?? []).map((wp) => ({
            id: wp.id,
            code: wp.code,
            name: wp.name,
            status: wp.status,
            deliverableId: wp.deliverable_id,
            hasContractor: wp.contractor_id !== null,
            // Manual PM/super urgency flag → ด่วน tag + ต้องทำ sort (spec 91
            // follow-up). isCritical stays reserved for the critical-path engine.
            priority: wp.priority,
            priorityRank: rankFromPriority(wp.priority),
            isCritical: criticalIds.has(wp.id),
          }))}
          deliverables={(deliverables ?? []).map((d) => ({
            id: d.id,
            code: d.code,
            name: d.name,
            sortOrder: d.sort_order,
          }))}
        />
      </section>
    </PageShell>

);
}
