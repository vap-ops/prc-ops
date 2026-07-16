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
- **HubNav** ([hub-nav.tsx](../src/components/features/chrome/hub-nav.tsx)) —
  desktop only (`hidden sm:block`), `bg-zinc-100` strip; active item
  `border-b-2 border-blue-700 font-semibold`.
- **BottomTabBar**
  ([bottom-tab-bar.tsx](../src/components/features/chrome/bottom-tab-bar.tsx)) —
  phone only (`sm:hidden`), fixed bottom, `bg-white/95 backdrop-blur` +
  `pb-[env(safe-area-inset-bottom)]`; active tab `text-blue-700` with top
  indicator bar; longest-prefix-wins matching. Per-role tab sets are the code
  constants (`SA_TABS`, `PM_TABS`, … — bottom-tab-bar.tsx is the SSOT; the old
  lists this doc pinned drifted twice, so it stopped pinning them). Canonical
  surface names + nav law: §12.
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

## 12. Nav surfaces — canonical names + rules (2026-07-11)

One name per navigation surface — used in specs, feedback triage, and operator
chat, so "the home tiles over-promise" is a complete sentence. This table names
the SURFACES; the current items live in code (the SSOT column) — read the
component for today's contents, never trust a doc-pinned list (see §6 note).

| Canonical name | What it is                                                                 | Code SSOT                                                                                                              |
| -------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| bottom tabs    | phone bar, fixed bottom; per-role sets (`SA_TABS`, `PM_TABS`, …)           | [bottom-tab-bar.tsx](../src/components/features/chrome/bottom-tab-bar.tsx)                                             |
| hub strip      | desktop-only top strip; per-role sets (`*_HUB_NAV`) mirror the bottom tabs | [hub-nav.tsx](../src/components/features/chrome/hub-nav.tsx)                                                           |
| home tiles     | เครื่องมือ quick-action grid on a role home (today: `/sa`)                 | [sa-tools.tsx](../src/components/features/sa/sa-tools.tsx)                                                             |
| settings hub   | grouped section rows on `/settings`                                        | [sections.ts](../src/app/settings/sections.ts)                                                                         |
| FAB            | floating action button — THE primary action of a screen (today: ถ่ายรูป)   | [camera-fab.tsx](../src/components/features/sa/camera-fab.tsx)                                                         |
| card chips     | inline quick-action row on a list card (e.g. รูปถ่าย · ทีมงาน · คำขอซื้อ)  | `ActionChip` in [sa/page.tsx](../src/app/sa/page.tsx)                                                                  |
| detail tabs    | segmented tab row inside a detail page                                     | [wp-detail-tabs.tsx](../src/components/features/work-packages/wp-detail-tabs.tsx)                                      |
| back chip      | the ← up affordance in every `DetailHeader`                                | [detail-header.tsx](../src/components/features/chrome/detail-header.tsx) + [back-href.ts](../src/lib/nav/back-href.ts) |
| switcher chip  | context switcher chip + sheet (today: ไซต์ปัจจุบัน on `/sa`, spec 292)     | [current-project-switcher.tsx](../src/components/features/sa/current-project-switcher.tsx)                             |
| nudge          | conditional entry banner — renders only while actionable (count > 0)       | e.g. the คำขอสมัคร nudge in [sa/page.tsx](../src/app/sa/page.tsx)                                                      |

Role variants read "SA bottom tabs", "PM hub strip" — matching the code
constants (`SA_TABS`, `PM_HUB_NAV`).

### Nav law (violations are review rejects)

1. **Bottom tabs hold GLOBAL destinations, never actions** — as few as the
   role's daily decisions need (lean 2-tab sets are deliberate; 5 tabs —
   `PM_TABS` / the spec-323 STR spine — is the current ceiling; don't grow a
   set past it without a spec. Spec 323 U3b collapsed the 7-tab
   `PROCUREMENT_MANAGER_TABS` to the 5-tab spine). Every tab is first-layer:
   tapping the ACTIVE tab returns to its section top (operator 2026-06-21;
   spec 169 mirrors this on the hub strip).
2. **The hub strip carries every bottom-tab destination** — desktop never
   omits a phone tab (labels may shorten for tab-bar space, e.g. กฎหมาย vs
   ฝ่ายกฎหมาย). The strip MAY add reference surfaces the tight phone bar
   omits (today: ทีมงาน `/workers` on the PM strip; `/workers` +
   subcontractors on the procurement strips) — supersets allowed, never
   subsets.
3. **One home per role** (`roleHome` in role-home.ts), and the home is always
   one of that role's tabs.
4. **Home tiles are shortcuts, never the only path.** A tile may duplicate a
   tab; removing a tile must not orphan a page — some persistent path (tab,
   strip, settings hub, or parent page) must remain.
5. **A menu label matches its destination's own title, and a tile subtitle
   lists ONLY actions that exist at the destination.** The recorded violation
   class: the 2026-07-11 SA-home menu audit found three tile subtitles
   promising actions their target page does not offer.
6. **Nouns name places, verbs name actions.** รูปถ่าย = the photos section
   (chip/tab); ถ่ายรูป = the capture action (FAB). Deliberate — keep the split.
7. **One term per concept app-wide**, single-sourced in `labels.ts` when used
   in 2+ files (§1).
8. **Settings hub = reference data + account, never daily decisions**
   (spec 93). Daily decisions live on tabs / home surfaces. _Procurement
   exception (spec 323):_ for the procurement tiers the `/procurement` STR hub
   is the primary door to their reference data too (แคตตาล็อก, ผู้ขาย,
   อุปกรณ์, …, as ขอบเขต/ทรัพยากร doors) — active money workflows (rental,
   expenses) leave procurement's ตั้งค่า for the Resources section (U4
   relocates the settings rows; other roles' settings view is unchanged).
9. **One FAB per screen**, reserved for that screen's primary action.
10. **Every nav change updates `site-map.md` in the same unit** (that doc's own
    contract) — its route tables carry the per-route "Back →" mapping; the
    back chip resolves it via `safeBackHref(?from, hierarchical parent)`
    (back-href.ts).
