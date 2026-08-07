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
Recorded exceptions — the single-column screens: `/profile` and
`/coming-soon` at `max-w-md`, `/login` at `max-w-sm`. Their loading
boundaries mirror those widths (§8).

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
- The `app` variant's `pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-0`
  clears the phone tab bar. It COMPOSES the safe-area inset because the bar
  does (`h-16` + `border-t` + `pb-[env(safe-area-inset-bottom)]` = 99px on a
  notched iPhone): a flat `pb-20` reserved 80px and left the last 19px of
  every content page behind the bar. Any new bottom-fixed chrome composes the
  inset the same way — toast-provider, phase-uploader, muster-cockpit and
  phone-po-basket all already did.
- **The `card` variant centres with AUTO MARGINS, never `items-center`** —
  on a scrolling flex container `align-items: center` puts the top of
  overflowing content out of reach of every scroll position (measured:
  150px unreachable for a 900px card in a 600px scroller). Auto margins
  centre identically while there is free space and collapse to 0 when
  there is not. Same rule for any new centred scroller (§8).
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
- **A constant that carries a colour cannot be overridden — compose the
  `_LAYOUT` half instead.** `CARD_LAYOUT` for `CARD`,
  `BUTTON_SECONDARY_LAYOUT` for `BUTTON_SECONDARY`,
  `BUTTON_SECONDARY_MUTED_LAYOUT` for `BUTTON_SECONDARY_MUTED`. `CARD`
  carries `bg-card` + `border-edge`; adding `bg-attn-soft`/`border-attn`
  on top puts two utilities for one CSS property on one element, and the
  winner is the one the GENERATED stylesheet emits LAST — Tailwind v4
  orders utilities alphabetically within a family — not the one written
  last in the className. `border-edge` beat every status border colour in
  the palette, so those cards silently rendered neutral (2026-07-26).
  **This holds for all THREE colour properties — background, border AND
  ink:** `text-ink` beats `text-danger`, so a destructive confirm written
  as a muted button plus `text-danger` renders neutral, and
  `text-ink-secondary` beats `text-ink`, so "step the emphasis up" on a
  muted constant does nothing. A `_LAYOUT` constant therefore carries
  **no colour of any kind**, and the call site names its own background,
  border and ink. The same applies to a FILE-LOCAL constant: split it
  (`TIER_ACTION_BASE`) rather than override it. Enforced by the
  colour-override scan in `tests/unit/ui-class-contracts.test.tsx`.
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
- **Form placement (nav-coherence audit 2026-07).** Every create/edit opens a
  **bottom sheet** (`common/bottom-sheet` — the app-wide default, ~50 call sites);
  a dedicated page or an inline-on-detail form requires a recorded reason —
  an onboarding workspace (`/register/*`, `/portal/claim`), field capture on the
  WP detail (phase uploader, labour log), or a spec-10 pinned form (the /requests
  PR raise). Detail and list pages stay read-only; the edit affordance is the
  sheet (spec 321 rule). A new dedicated-page CRUD without one of those reasons is
  a review reject.

## 8. Loading

Every route group has a `loading.tsx`. A CONTENT page's renders
[page-skeleton.tsx](../src/components/features/chrome/page-skeleton.tsx) — it
mirrors the page anatomy (zinc-50 main, white header strip, `h-16
rounded-lg` row placeholders) at `PAGE_MAX_W`. A SINGLE-COLUMN screen's renders
[narrow-skeleton.tsx](../src/components/features/chrome/narrow-skeleton.tsx)
instead (see below); `/portal` keeps its own. **Pick the frame that matches the
page the boundary stands in for — the fallback's job is to not move when it is
replaced.**

**A loading boundary is a route, so it renders `PageShell` like every other route**
(§5). `PageSkeleton` used to hand-roll `<main class="bg-page min-h-screen
overflow-x-clip">`, which is not a scroller — the body is locked, so that `<main>`
grows past the viewport and the overflow is clipped with no gesture able to reach
it. Measured in a real browser 2026-08-06, phone landscape 812×375: the skeleton's
own content is 433px tall, its last row was cut at y=409, and the row had **zero
user-scrollable ancestors**; the same wrapper with taller content put 29 of 40 rows
permanently out of reach, while identical content inside `PageShell` scrolled.
jsdom has no layout engine, so no unit test can see this class. Three pins carry it
instead: the class contract + the delegation in
[page-skeleton-shell.test.tsx](../tests/unit/page-skeleton-shell.test.tsx); the
repo-wide scan in
[design-doctrine.test.ts](../tests/unit/design-doctrine.test.ts) ("every page
scroller clips horizontal overflow"), which reads every `.ts`/`.tsx` under `src/`
with comments stripped so `page-shell.tsx` stays the only file containing a
`<main>`; and the per-boundary render sweep in
[nav-loading-boundaries.test.ts](../tests/unit/nav-loading-boundaries.test.ts),
which asserts every one of the 45 `loading.tsx` files renders an announcement AND a
`h-full overflow-y-auto` `<main>`.

**The skeleton also carries `PAGE_MAX_W`** (operator sign-off 2026-08-06, retiring the
`65-consolidation-pass` queue entry). A fallback that stands in for a page and does not
share its width IS a horizontal jump at the swap: measured on `/dashboard` with both
states in one DOM, the fallback was **768px against the page's 1240 at 1280×800**, 768
vs 860 at 900, and **760 vs 672 at a 760px viewport** — the skeleton's private
`max-w-3xl` left the viewport as the effective cap right through the 672–768 band, so
the two only already agreed below 672. `max-w-3xl` now appears nowhere in `src/`; the
remaining `max-w-sm`/`max-w-md` are the recorded single-card exceptions in §5, not
outliers. `variant="app"` also brings `pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-0`
(phone tab-bar clearance, safe-area inset included — see §5) and
`text-ink` — the skeleton renders no visible text.

**The SINGLE-COLUMN screens have their own frame:**
[narrow-skeleton.tsx](../src/components/features/chrome/narrow-skeleton.tsx). `/login`,
`/coming-soon` and `/profile` are §5's recorded width exceptions — a `max-w-sm`/`max-w-md`
column, not a content page — and delegating them to `PageSkeleton` painted a header strip
and list rows at `PAGE_MAX_W` instead. Measured on `/coming-soon` at 1280×800 with both
states in one DOM: the fallback's container was **1240px on `bg-page`**, the page's
**448px on `bg-card`** — width is the smaller half, the GROUND flips too, so the whole
screen flashes at the swap.

`NarrowSkeleton` takes **PageShell's own variant vocabulary**, and each boundary passes
the variant its PAGE renders — pinned in
[narrow-loading-skeleton.test.tsx](../tests/unit/narrow-loading-skeleton.test.tsx),
which reads the page's own `PageShell` call so the two cannot drift:

| boundary       | variant | width | because the page is                                                                                                                                                                                     |
| -------------- | ------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`       | `card`  | `sm`  | `variant="card"`, a `max-w-sm` column centred, no header                                                                                                                                                |
| `/coming-soon` | `card`  | `md`  | THREE arms — the unserved-role card, `VisitorLanding`'s card, and the super_admin `OperatorHub` at `bare`+`bg-card`; all a `max-w-md` column on the card ground, none with a header                     |
| `/profile`     | `app`   | `md`  | an APP-variant page with a `max-w-md` column **under a sticky `DetailHeader`** — so the app arm paints a header strip too; a centred headerless card frame would be a NEW mismatch on the vertical axis |

**Both axes are read off the page**, never re-typed: the pin derives the variant from the
page's own `PageShell` call and the width from the page's own column class, so changing
either on the page reds until the boundary follows. The width column closed the last
WIDTH residual (2026-08-06): the frame originally shipped at a fixed `max-w-md`, leaving
`/login`'s fallback 448px against its 384px card — measured live, and 384 vs 384 after. The
width pin reads every file that renders one of a screen's ARMS, not just `page.tsx`, because
`/coming-soon`'s visitor arm lives in `visitor-landing.tsx`.

✅ **The last residual is closed (2026-08-06), and it was a symptom, not the disease.**
`/coming-soon`'s super_admin arm was TOP-aligned (`variant="bare"`) while the other two
centred — so the fallback could match at most two of three. That `bare` was a 1:1 port of a
hand-rolled `<main>` from before `PageShell` existed (`git show 9248267c` / `e600c4ed`), not a
deliberate opt-out — but moving the arm onto `card` first required fixing a real trap:
**`align-items: center` on a scrolling flex container centres overflowing
content by pushing its top ABOVE the scrollable area, where no scroll position reaches it.**
Measured against the real stylesheet — a 900px card in a 600px scroller: top `−150`,
`scrollHeight` 750, `maxScroll` 150, i.e. **150px unreachable**. So `card` now centres with
**auto margins** (`items-start … [&>*]:m-auto`), which centre identically while free space is
positive and collapse to 0 when it is not: the same card reports top `0`, `scrollHeight` 900,
`maxScroll` 300. Short content is byte-identical to before (top 150 either way). With the trap
gone, the hub arm adopts `card` and all three arms — and the fallback — agree.
**Every `card` screen gained the fix:** `/login`, `/coming-soon`, `error.tsx`, `not-found.tsx`,
`page.tsx`, `visitor-landing.tsx` and `narrow-skeleton.tsx` — the loading frame, and the only
caller passing two children, which is what `[&>*]` had to be checked against.
⚑ The hub keeps its own `py-10` and the fallback does not, so the two step 40px apart once the
hub overflows. ⚠️ `variant="bare"` now has **zero** production callers — kept for the API and
its own test, not deleted here.

⚠️ **Not card-only, and the measurement is why:** `/login` and `/coming-soon` are both in
the telemetry `EXCLUDED_PREFIXES` (`src/lib/telemetry/scope.ts`), so their usage is
**unmeasurable — not zero**; `/profile` is measurably alive (91 route views / 73 sessions
/ 9 roles in 60 days). A card-only fix would have landed entirely on surfaces whose value
cannot be observed.

One deliberate exception to the SHARED SKELETON — not to the shell:
`src/app/portal/loading.tsx` keeps its own frame because it mirrors the portal's
sticky header and card sizes, and it renders `PageShell` itself. It announces
exactly as the shared skeleton does; see below.

### Announcing the wait

Every boundary — shared or bespoke — renders
[`<LoadingAnnouncement />`](../src/components/features/chrome/loading-announcement.tsx),
and nothing else announces loading. The leaf has two parts, and the live region
is the one that does the work:

- **the live region carries both navigation paths.** Once the leaf's effect has
  run it writes to
  [`<RouteAnnouncer />`](../src/components/features/chrome/route-announcer.tsx),
  a single `role="status" aria-live="polite" aria-atomic="true"` region mounted
  once in `src/app/layout.tsx`, beside `{children}` — on a client-side
  navigation _and_ on a full load whose fallback is still up after hydration.
  This is the part that makes a boundary audible; a `loading.tsx` fallback is
  otherwise just a DOM swap, and readers announce inserted nodes only inside a
  live region that was already present.
- **the static sr-only `กำลังโหลด…` is the pre-hydration fallback.** It is in
  the streamed HTML, so it covers the window before the effect can run (and a
  JS-disabled read). Do not over-claim it: readers announce the title and focus
  on load, not the whole body, so that node is reached only if the user happens
  to be traversing the document during the wait.

Four rules, pinned by
[route-loading-announcement.test.tsx](../tests/unit/route-loading-announcement.test.tsx)
and
[route-arrival-announcement.test.tsx](../tests/unit/route-arrival-announcement.test.tsx),
and — for the two boundary surfaces together — by
[portal-loading-announcement.test.tsx](../tests/unit/portal-loading-announcement.test.tsx):

1. **The region is never declared by a boundary.** A live region inserted
   already containing its text is not announced — readers speak _mutations_ of a
   region that was already there. A repo-wide scan fails any `loading.tsx` (or
   `PageSkeleton`) containing `aria-live` / `role="status"` / `role="alert"`.
2. **It is polite, never assertive.** Waiting is not an emergency and must not
   interrupt a reader mid-sentence; `role="alert"` is reserved for real events
   (the same call as the update chip, §6).

   ⚠️ **Do not assume the framework announces arrival — it does not.** Next.js
   mounts a persistent announcer of its own
   (`client/components/app-router-announcer`, a shadow-DOM
   `role="alert" aria-live="assertive"` node), and reading that source suggests
   it speaks `document.title` on every route change. Measured on a live server,
   it does not: across four navigations it stayed **empty** on three whose title
   had provably changed, and on the fourth announced `สวัสดี คุณ…` — the SA
   home's `<h1>`, neither the destination nor the page being left. Root cause,
   measured: **Next REPLACES the `<title>` node rather than editing its text**,
   so `document.title` is empty for ~3–170 ms per navigation, and that is the
   window its effect samples in — hence the `h1` fallback.

   **It is therefore SILENCED** (`RouteAnnouncer` sets `aria-live="off"` and
   removes `role="alert"` on the node inside `<next-route-announcer>`'s shadow
   root). Across 7 measured navigations it was correct **zero** times — usually
   silent, once announcing the user's own name, assertively, for a page they
   were not on — while our polite region got every one right. Two ARIA
   attributes is the narrowest intervention available: no patched framework
   file, no removed DOM, and nothing breaks if a future Next stops shipping the
   announcer. Safe because React portals the announcement TEXT into that div but
   does not own the element — verified in a real browser, where the change stuck
   across navigations and a probe tag on the node survived. Rule 4 carries the
   truth instead. **Reported upstream:
   [vercel/next.js#96797](https://github.com/vercel/next.js/issues/96797)** — if
   it is fixed, this silencing becomes unnecessary rather than harmful, and can
   simply be deleted.

3. **Each announcement gets a fresh node identity** (`key={seq}`). Every boundary
   says the same words, and React unmounts one fallback and mounts the next in a
   single commit — so without a new key the region re-renders identical text and
   **no DOM mutation occurs at all**, which no reader can announce. What the key
   guarantees, and what was measured (unit test plus a live `MutationObserver`),
   is the mutation. Whether a given reader then _speaks_ a consecutive update
   whose text is byte-identical to the last one is reader-dependent and was not
   measured — several suppress it. Closing that residual risk would mean letting
   the region pass through empty between announcements (e.g. publishing the next
   message in a `queueMicrotask` so the clear commits first); recorded, not
   built.

4. **Arrival is announced through the SAME region, and it DEFERS behind the
   wait.** `RouteAnnouncer` watches `document.head` (not the `<title>` node —
   Next replaces it, so a node-bound observer goes deaf after one navigation)
   and reports each new destination via `announceArrival`. Two rules fall out of
   the measurements, both pinned:

   - **Strip the `— PRC Ops` suffix, and stay SILENT for a page that set no
     title of its own.** Never fall back to the `<h1>`: on 4 of 5 sampled pages
     it reads `สวัสดี คุณ<ชื่อ>`, so announcing it reads the user their own name
     on arrival. Titles are per ROUTE, not per record — 39 dynamic-segment pages
     reuse one title for every record, which is why the de-dupe below is keyed on
     the pathname as well as the name.

     **Because of this, a page with no `metadata.title` is a SILENT page, not
     merely a dull browser tab** — so
     [page-metadata-titles.test.ts](../tests/unit/page-metadata-titles.test.ts)
     requires one on every `page.tsx`. The only exemptions are pages that never
     render a name because they redirect to one that has it, and each is verified
     rather than trusted: it must still exist, still lack a title, and still
     actually redirect, so a real page cannot be waved through by adding it to
     the list.

   - **Defer while a boundary is open.** The title is correct **640–930 ms
     before** the content renders, so announcing on the title alone would tell
     the user they had landed on a page that is still a skeleton. Verified in
     real Chrome: `กำลังโหลด…` at +1048 ms, title at +1056 ms, `โครงการ` at
     **+1797 ms** — the announcement waits for the content, not the title. One
     region for both means the two can never overlap in CONTENT.
   - **De-dupe on the navigation, not the words.** Keying on the title alone
     would silence the app's commonest movement, because a dynamic route's title
     is the same for every record (`work-packages/[workPackageId]` is
     `รูปถ่ายงาน` for all of them), so WP→WP would read as a repeat. The pathname
     has already changed by the time the new title lands (measured: pathname
     +1074 ms, title node re-added +1100 ms). Comparing both is also what keeps
     a same-page node replacement silent.

   - **A boundary HANDOFF must not swallow the destination.** React releases one
     skeleton and opens the next inside a SINGLE commit as a segment resolves
     deeper, so the count passes through zero while the wait is still on.
     Publishing there consumed the destination and the incoming boundary
     overwrote it — measured in real Chrome on a project-detail navigation:
     `กำลังโหลด…` for nine seconds and then **silence**. So the release DEFERS the
     arrival by a microtask and re-checks the count once the commit has settled.
     Only the arrival is deferred; clearing the region stays synchronous,
     because a clear cannot be invalidated by what follows.

   ⚑ **One ordering edge is recorded, not built:** if a title ever landed before
   its boundary opened, arrival would be spoken and then replaced by
   `กำลังโหลด…`. Measured, the boundary opens 6–8 ms FIRST on every sampled
   navigation, so this is theoretical today; the same microtask-and-recheck would
   close it.

Also pinned: **every boundary must render an announcement** — `<PageSkeleton />`
or `<LoadingAnnouncement />` — so a new bespoke `loading.tsx` cannot ship mute
the way `/portal` did. The negative rule alone permitted no shape at all.

The route-boundary wording lives in `ROUTE_LOADING_MESSAGE`
([route-announcement.ts](../src/lib/ui/route-announcement.ts)), not in the
boundaries — it used to be typed into both of them. Note this is not a
repo-wide consolidation: `กำลังโหลด…` is still typed inline in a few
_in-component_ busy states (equipment history sheet, photo lightbox), which are
a different thing from a route boundary and are out of scope here.

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

| Canonical name | What it is                                                                                                                                        | Code SSOT                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bottom tabs    | phone bar, fixed bottom; per-role sets (`SA_TABS`, `PM_TABS`, …)                                                                                  | [bottom-tab-bar.tsx](../src/components/features/chrome/bottom-tab-bar.tsx)                                                                                                                    |
| hub strip      | desktop-only top strip; per-role sets (`*_HUB_NAV`) mirror the bottom tabs                                                                        | [hub-nav.tsx](../src/components/features/chrome/hub-nav.tsx)                                                                                                                                  |
| home tiles     | เครื่องมือ quick-action grid on a role home (today: `/sa`)                                                                                        | [sa-tools.tsx](../src/components/features/sa/sa-tools.tsx)                                                                                                                                    |
| door chips     | icon-only 44px door row on top of a surface (spec 327 U6: `/procurement` + its sections; the ทั้งหมด grid on หน้าหลัก is the labeled rule-4 path) | [procurement-door-chips.tsx](../src/components/features/purchasing/procurement-door-chips.tsx) + [procurement-all-doors.tsx](../src/components/features/purchasing/procurement-all-doors.tsx) |
| settings hub   | grouped section rows on `/settings`                                                                                                               | [sections.ts](../src/app/settings/sections.ts)                                                                                                                                                |
| FAB            | floating action button — THE primary action of a screen (today: ถ่ายรูป)                                                                          | [camera-fab.tsx](../src/components/features/sa/camera-fab.tsx)                                                                                                                                |
| card chips     | inline quick-action row on a list card (e.g. รูปถ่าย · แรงงาน · คำขอซื้อ — the middle one reads `LABOR_TAB_LABEL`, spec 313 U2)                   | `ActionChip` in [sa/page.tsx](../src/app/sa/page.tsx)                                                                                                                                         |
| detail tabs    | segmented tab row inside a detail page                                                                                                            | [wp-detail-tabs.tsx](../src/components/features/work-packages/wp-detail-tabs.tsx)                                                                                                             |
| back chip      | the ← up affordance in every `DetailHeader`                                                                                                       | [detail-header.tsx](../src/components/features/chrome/detail-header.tsx) + [back-href.ts](../src/lib/nav/back-href.ts)                                                                        |
| switcher chip  | context switcher chip + sheet (today: ไซต์ปัจจุบัน on `/sa`, spec 292)                                                                            | [current-project-switcher.tsx](../src/components/features/sa/current-project-switcher.tsx)                                                                                                    |
| nudge          | conditional entry banner — renders only while actionable (count > 0)                                                                              | e.g. the คำขอสมัคร nudge in [sa/page.tsx](../src/app/sa/page.tsx)                                                                                                                             |

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
   exception (spec 323 → 327):_ for the procurement tiers the `/procurement`
   surfaces are THE door to their reference data — since spec 327 U6c as
   icon **door chips** on top of หน้าหลัก + each S/T/R section page (the
   section text grids retired; the ทั้งหมด labeled grid on หน้าหลัก is the
   rule-4 labeled path). ตั้งค่า stays shrunk (sections.ts
   `isProcurementTier`) and `PROCUREMENT_SETTINGS_TAB` match = `/profile`
   only; the หน้าหลัก tab claims `/requests` (U6b strand fix). ทีมช่าง
   (roster/payroll/labor-rates) stays dual-homed by design. Other roles'
   settings view + tab matches are unchanged — rule 8 still governs them.
9. **One FAB per screen**, reserved for that screen's primary action.
10. **Every nav change updates `site-map.md` in the same unit** (that doc's own
    contract) — its route tables carry the per-route "Back →" mapping; the
    back chip resolves it via `safeBackHref(?from, hierarchical parent)`
    (back-href.ts).
