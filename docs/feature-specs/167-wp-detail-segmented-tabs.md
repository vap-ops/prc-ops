# Spec 167 — WP detail segmented tabs: cut the long scroll into focused sections

## Problem

The operator (2026-06-21): _"WP detail page is too long with contents, scrolling
through unrelated contents is distracting."_

`/projects/[projectId]/work-packages/[workPackageId]` is **one long vertical
scroll** that stacks, top to bottom:

1. Header nameplate (code · name · status · ⓘ) — sticky (spec 63).
2. Phase progress bar.
3. **Planner management block** (PM/super/director only): rename · priority ·
   deliverable bind · schedule + dependencies · delete. Tall — and it sits
   _above_ the hero, pushing the page's primary job (capture) down.
4. Attention stack (PM decision feedback · unassigned-contractor · pending-
   requests chip) and defect cards.
5. HERO — รูปถ่ายงาน photo capture.
6. คำขอซื้อ (two create forms + the request list) → บันทึกแรงงานรายวัน → ข้อมูลงาน
   (notes + ประวัติการตรวจ).

To reach labor a site admin scrolls past two purchase forms; a planner scrolls
past the whole management block to reach photos. Everything is always expanded,
so every visit pays the full height regardless of intent.

The fix the operator chose (AskUserQuestion, 2026-06-21): **segmented tabs** — a
tab bar that shows one section at a time. Most app-like, biggest scroll cut.

## Decision

Split the body into **segmented tabs**; keep the always-relevant chrome pinned
above them.

**Pinned (always visible, never behind a tab):**

- The header nameplate (unchanged).
- The phase progress bar (compact at-a-glance status).
- The **attention stack** + **defect cards** — these are _needs-action_ prompts
  ("must assign a contractor", "PM asked for revision", "report a defect"). Spec
  94 already ruled the unassigned-contractor prompt must not be buried behind a
  tap; the same logic pins the whole stack.

**Tabs (one panel shown at a time), in order:**

| key         | label    | panel                                                           |
| ----------- | -------- | --------------------------------------------------------------- |
| `photos`    | รูปถ่าย  | the photo capture zone (default tab — capture is the job)       |
| `purchases` | คำขอซื้อ | สร้างคำขอซื้อ + บันทึกการซื้อหน้างาน forms + the request list   |
| `labor`     | แรงงาน   | the daily labor log zone                                        |
| `info`      | ข้อมูล   | WP notes + ประวัติการตรวจ (approval history)                    |
| `manage`    | จัดการ   | the planner management block — **rendered only when isPlanner** |

The per-section `<h2>` headings (Camera / ShoppingCart / Users / FileText) are
dropped — the tab label now names the section.

### Why a client switcher with all panels mounted (not URL `?tab=` nav)

`WpDetailTabs` is a client component. It renders the tablist and toggles panels
with the `hidden` attribute — **every panel stays mounted**, only the active one
is shown. Two reasons this beats per-tab navigation:

- The page does **one** server fetch (spec 147's `loadWorkPackageDetail`).
  Re-navigating per tab (`?tab=`) would re-run that loader on every tap.
- Panels hold **live form state** — a half-typed purchase request or labor row
  must survive an accidental tab tap. Unmounting would discard it.

So the initial DOM is the same as today (everything already renders); the only
change is that inactive sections are `display:none`, focusing the view.

### Deep link

The pending-requests `CountChip` keeps `href="#wp-requests"`. `WpDetailTabs`
takes a `hashTabMap={{ "wp-requests": "purchases" }}` and listens for
`hashchange` — tapping the chip switches to the คำขอซื้อ tab instead of an
anchor scroll.

This is a **pure UI restructure** — no DB, no schema, no route, no new server
query. Same data, same components, regrouped.

## Scope (exactly this)

1. **`WpDetailTabs`** — new client component
   (`src/components/features/work-packages/wp-detail-tabs.tsx`). Props:
   `tabs: { key: string; label: ReactNode; panel: ReactNode }[]` and optional
   `hashTabMap?: Record<string, string>`. Renders a WAI-ARIA tablist
   (`role="tablist"` / `role="tab"` / `role="tabpanel"`, `aria-selected`,
   `aria-controls`/`aria-labelledby`), defaults to the first tab, switches on
   click, supports arrow / Home / End roving focus, and answers `hashTabMap` on
   mount + `hashchange`. Inactive panels carry `hidden` (stay mounted). Active
   tab uses the `text-action` + bottom-indicator treatment (mirrors
   `BottomTabBar`); ≥44px tap floor. Token classes only (design-doctrine).

2. **WP page** (`…/work-packages/[workPackageId]/page.tsx`) — regroup the body:
   keep the header + progress bar + attention/defect pinned; move photos /
   purchases / labor / info / manage into `<WpDetailTabs tabs={…}>`. The
   `manage` tab is appended only when `isPlanner`. Drop the section `<h2>`s and
   the now-unused icon imports. Pass `hashTabMap={{ "wp-requests": "purchases" }}`.

3. **Tests (path b — restructure, behaviour-pinned):**
   `tests/unit/wp-detail-tabs.test.tsx` — one tab per section + default-first;
   every panel mounted with inactive ones `hidden`; click switches the active
   panel; a mapped `hashchange` opens the right tab.

## Out of scope / preserved

- **No sticky tab bar** this unit. The header is already `sticky top-0` with a
  _dynamic_ height; a second sticky bar below it needs that height as its `top`
  offset (fragile). The tablist sits in normal flow under the pinned progress
  bar — still near the top, and each panel is now short. Sticky-on-scroll is a
  recorded follow-up.
- The **attention stack, defect cards, and progress bar stay pinned** — not
  tabbed (needs-action / at-a-glance).
- The header **ⓘ sheet** (spec 94 contractor + description) is untouched.
- The **PM review** WP page (`/review/work-packages/[workPackageId]`) is a
  separate surface — not touched. One-component follow-up if wanted there.
- No DB, schema, route, or new server query.

## Verification checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` green; the new test passes.
- [ ] `pnpm build` green.
- [ ] WP page: pinned header + progress bar + (when present) attention/defect;
      below them a tab bar รูปถ่าย · คำขอซื้อ · แรงงาน · ข้อมูล (+ จัดการ for PM).
- [ ] รูปถ่าย is the default tab; tapping a tab swaps the panel; a half-typed
      purchase request survives a tab switch (panels stay mounted).
- [ ] The pending-requests chip jumps to the คำขอซื้อ tab.
- [ ] จัดการ appears for PM/super/director, absent for site_admin.
- [ ] Acceptance = operator phone (PM/SA-gated routes; preview env only renders /login).

## U2 — แรงงาน → ทีมงาน terminology sweep (2026-06-21)

Operator: _"แรงงาน is sensitive word, do we have options?"_ — แรงงาน ("labor/laborer")
carries the manual-laborer connotation the team already moved away from (คนงาน →
ทีมงาน/ช่าง in the pay model). **ทีมงาน** is already the de-facto SSOT for the
workforce (the `/workers` registry is titled ทีมงาน, the roster manager, the labor
picker "ค้นหาทีมงาน", Nova, and the contacts crew all use it); แรงงาน only survived
as the abstract noun "labor" in a few scattered literals. Operator chose **ทีมงาน**

- **full sweep**.

Replaced every user-facing แรงงาน (10 spots, phrased per context — not a blind
find-replace, which would read awkwardly in verb/measure positions):

- WP-detail labor tab label `แรงงาน` → `ทีมงาน`.
- Labor log button `บันทึกแรงงาน` → `บันทึกทีมงาน` (+ the `labor-log-zone` tests).
- Generic labor-save error `บันทึกแรงงานไม่สำเร็จ…` → `บันทึกทีมงานไม่สำเร็จ…`.
- Over-allocation flag `ลงแรงงานเกิน 1 วัน…` → `ลงเกิน 1 วัน…` (dropped the noun —
  ทีมงาน reads awkwardly as the logged unit here).
- PM review page: heading `บันทึกแรงงานรายวัน` → `บันทึกทีมงานรายวัน`; variance card
  `ภาพถ่ายกับวันลงแรงงานไม่ตรงกัน` → `…วันลงทีมงาน…`; `มีรูปแต่ไม่ได้ลงแรงงาน` /
  `ลงแรงงานแต่ไม่มีรูป` → `…ลงทีมงาน…`.
- Delete-guard copy (control + action): `…มีรูป แรงงาน หรือคำขอซื้อ…` → `…มีรูป
ทีมงาน หรือคำขอซื้อ…`.

Not touched (deliberate): **ค่าแรง** (wage/labor-cost — a standard accounting term,
not flagged) and a pgTAP fixture WP name `'มีแรงงาน'` (internal test seed, never
user-facing). **Follow-up (recorded):** ทีมงาน still lives as ~20 scattered literals
app-wide — single-sourcing it in `labels.ts` (per the term-consistency SSOT doctrine)
is its own cleanup, out of scope here.
