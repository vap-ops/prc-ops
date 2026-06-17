# Spec 138 — Mobile worklist redesign (procurement /requests)

- Status: Draft (2026-06-18). Source: a Claude Design (claude.ai/design) handoff bundle —
  "Mobile-first redesign for tablets", primary file `PRC Ops Worklist Mobile.dc.html`. The
  operator mocked the desktop→mobile worklist UX in HTML/CSS/JS and asked to implement the
  relevant aspects. The prototype recreates the procurement worklist on a 390px phone.

## Where the prototype already exists

Most of the mock is already shipped on the procurement `/requests` view and stays as-is:
navy `AppHeader`, the 2×2 KPI tiles (`BuyerStat`: รอสั่งซื้อ / กำลังจัดส่ง / เกินกำหนด / ค้างจ่าย),
the action-state bands (spec 104), the bundled PO cards (`PoGroupCard`, spec 134 U2), the
phone PO-merge basket (`PhonePoBasket`, spec 118), the detail bottom sheet (`BottomSheet`),
and the bottom tab nav (`BottomTabBar`). Only the genuinely net-new affordances from the
mock become units here; we do not rebuild what exists.

## Units

- **U1 — "ต้องติดตามด่วน" urgent-follow-up panel.** SHIPPED. The mock's headline addition: an
  inline card listing the actual overdue deliveries (not just the เกินกำหนด count), each row
  tapping into the request detail, with a footer link to the full overdue (chase) filter.
  (Refinement: phone-hidden, tablet/desktop only — see U1 Change.)
- **U2 — KPI hero row.** THIS UNIT (driven by the desktop handoff `PRC Ops Worklist.dc.html`).
  The four KPI tiles restyled to the mock — each tile an icon chip + big value + caption, the
  รอสั่งซื้อ tile the amber hero; and the desktop layout lays the 2×2 KPI grid BESIDE the
  attention panel (`1fr / 332px`) instead of stacking it below.
- **U3 — scrollable status-chip filter with live counts.** SHIPPED. Replace the procurement
  status `<select>` with horizontally-scrollable pills (ทั้งหมด / อนุมัติแล้ว / กำลังจัดส่ง /
  เกินกำหนด) each showing a live count. Introduces the band→filter mapping (the seam U2
  flagged), so a later unit can make the รอสั่งซื้อ / กำลังจัดส่ง KPI tiles tap-to-filter too.
- **U4 — KPI hero tiles tap-to-filter.** THIS UNIT. Make the รอสั่งซื้อ (`to_order`) and
  กำลังจัดส่ง (`in_transit`) KPI hero tiles clickable band toggles (the mock's clickable tiles,
  deferred from U2/U3), reusing the band axis U3 added. The เกินกำหนด tile keeps its existing
  overdue chase toggle; the ค้างจ่าย tile stays static (no band).

## U1 — Change (app-only, no schema)

- **Pure helper** `src/lib/purchasing/overdue-attention.ts` (TDD): `selectOverdueFollowUp(rows,
todayIso, limit = 4)` → the in-transit rows whose ETA is past today, sorted most-overdue
  first (earliest ETA), capped at `limit`, each mapped to `{ id, prNumber, itemDescription,
supplier, eta, amount, overdueDays }`. "Overdue" reuses `procurementBand(status) ===
"in_transit"` + `eta != null && eta < todayIso`, so the panel's set is exactly the
  เกินกำหนด KPI's (spec 105 `procurementSummary.overdue`). `overdueDays` = whole days
  between ETA and today (≥ 1 by the filter).
- **Component** `src/components/features/purchasing/overdue-follow-up-panel.tsx` (server-safe,
  presentational, no `'use client'`): a `bg-card`/`border-edge`/`rounded-card` panel headed
  by a danger-toned "ต้องติดตามด่วน" row with the count; each item row is a `<Link>` to
  `/requests/{id}` showing a danger dot · item name (truncate, sibling-card parity) · supplier
  · `เกิน N วัน` · amount (font-mono); a footer `<Link>` "ดูทั้งหมดที่เกินกำหนด" → the overdue
  filter. Field-First tokens only (danger trio + ink/edge/card), no raw palette, no green-\*.
- **Wire** `src/app/requests/page.tsx`: compute `attentionItems` for procurement (after the
  `amountById` admin read — the panel shows amount, already back-office for procurement), and
  render the panel in the procurement column right after the KPI grid, before the filters,
  only when `attentionItems.length > 0`. The overdue footer href reuses the existing
  `buildWorklistQuery({ ...filter, overdue: true })` (same target as the เกินกำหนด tile).
- **Refinement (2026-06-18, operator):** dropped from the PHONE view (`hidden lg:block`) —
  the panel renders only on tablet/desktop (lg+). On the phone the เกินกำหนด KPI tile (its
  filter toggle) is the chase entry point; the panel was redundant on the small screen.

## U2 — Change (app-only, no schema)

- **Pure helper** `src/lib/purchasing/worklist-kpis.ts` (TDD): `buildWorklistKpis({ summary,
outstanding, overdueHref, overdueActive })` → the four tile descriptors `{ key, label, value,
caption, tone, icon, href, active }` in display order (รอสั่งซื้อ · กำลังจัดส่ง · เกินกำหนด ·
  ค้างจ่าย). Reuses the spec-105 `ProcurementSummary` counts + a preformatted `outstanding`
  string. The เกินกำหนด tile carries the chase-toggle `href`/`active` (its tone is `danger`
  when overdue > 0 or the filter is active, else `neutral`); the others are static
  (`hot` / `shipping` / `neutral`), `href: null`.
- **Component** `src/components/features/purchasing/worklist-kpi-tile.tsx` (`WorklistKpiTile`,
  server-safe): renders one descriptor — an icon chip (lucide Clock / Truck / AlertTriangle /
  Wallet keyed by `icon`), the big value, the label, and the caption — toned per `tone`
  (hot = amber fill `bg-attn`; shipping = white card, `text-action` value + `bg-action-soft`
  chip; danger = `bg-danger-soft`; neutral = white card). A tile with `href` renders as a
  `<Link>` with a pressed ring when `active` (replaces the old inline `BuyerStat`). Field-First
  tokens only — flat amber, NOT the mock's raw gradient (doctrine: no raw palette).
- **Wire** `src/app/requests/page.tsx`: build the tiles and map to `WorklistKpiTile`; wrap the
  2×2 KPI grid + the U1 attention panel in a responsive grid so they sit SIDE BY SIDE on lg+
  (`lg:grid-cols-[minmax(0,1fr)_332px]`) and stack on phone (panel stays `hidden lg:block`).
  Drop the now-dead `BuyerStat` local. Click behaviour preserved: only the เกินกำหนด tile is a
  filter toggle (the mock's other clickable tiles need band-status mapping — out of scope, U3).

## U3 — Change (app-only, no schema)

The mock's status chips are BAND-level, not raw-status: ทั้งหมด (all) / อนุมัติแล้ว (the
`to_order` band — "approved", ready to buy) / กำลังจัดส่ง (the `in_transit` band — purchased +
on_route) / เกินกำหนด (overdue). A single raw `status` enum can't express "purchased OR
on_route", so U3 adds a **band filter axis** (the seam U2 flagged) and reuses the existing
`overdue` axis for the chase chip.

- **Filter axis** `src/lib/purchasing/worklist-filter.ts` (TDD): add `band: ProcurementBand |
null` to `ProcurementFilter`. `matchesProcurementFilter` AND-composes it
  (`procurementBand(row.status) === filter.band`). `buildWorklistQuery` serializes it as
  `?band=to_order|in_transit` (dropped when null). The raw `status` axis STAYS (no UI now, but
  a hand-edited `?status=rejected` still surfaces the banded-out rejected/cancelled history —
  the only escape, kept to avoid a regression while removing the `<select>`).
- **Pure helper** `src/lib/purchasing/worklist-status-chips.ts` (TDD): `buildWorklistStatusChips({
rows, filter, todayIso })` → the four chip descriptors `{ key, label, count, href, active }`
  in order (all · to_order · in_transit · overdue). `rows` is the supplier/project-narrowed set
  (counts are LIVE to those axes); counts reuse `procurementSummary` (to_order/in_transit/
  overdue) + `all` = rows with a non-null band (the pipeline set). `href` reuses
  `buildWorklistQuery` preserving supplier/project/status while setting band+overdue per chip
  (all → both cleared; to_order/in_transit → that band, overdue off; overdue → overdue on, band
  cleared). `active` marks the current selection (overdue wins; else the band; else all).
- **Component** `src/components/features/purchasing/worklist-status-chips.tsx` (server-safe,
  presentational, no `'use client'`): a horizontally-scrollable (`overflow-x-auto`) row of
  `<Link>` pills, each label + a count badge, the active pill filled. Field-First tokens only
  (mirrors the spec-137 `worklistChipClass`: `bg-fill/text-on-fill` active, `border-edge-strong/
bg-card` idle), min-h-11 tap target, no raw palette.
- **Wire** `src/app/requests/page.tsx`: parse `?band` (validated against `ProcurementBand`),
  build the chips over the supplier/project-narrowed rows, render `<WorklistStatusChips>` in the
  procurement column between the KPI grid and the supplier/project filters. Add `filter.band` to
  `filterActive`. Band filtering flows through `matchesProcurementFilter` + the existing
  `groupByProcurementBand` (an active band yields that one group); the `status` flat-group branch
  is untouched (still serves the `?status=` URL escape). Remove the status `<select>` (+ its now-
  dead `STATUS_OPTIONS`/label import) from `ProcurementFilters`; supplier/project pickers stay.

## U4 — Change (app-only, no schema)

The mock's รอสั่งซื้อ / กำลังจัดส่ง KPI tiles are clickable filters (deferred from U2 —
"needs the band→status mapping", which U3 then built). The band axis (`ProcurementFilter.band`,
`buildWorklistQuery ?band=`, `matchesProcurementFilter`) is now in place, so the tiles only
need href/active.

- **Pure helper** `src/lib/purchasing/worklist-kpis.ts` (TDD): `buildWorklistKpis` now takes
  `{ summary, outstanding, filter }` (the full `ProcurementFilter`) in place of the pre-built
  `overdueHref`/`overdueActive` pair, and derives every tile's `href`/`active` internally via
  `buildWorklistQuery` — mirroring the U3 `buildWorklistStatusChips` so the toggle logic lives in
  one place. The รอสั่งซื้อ / กำลังจัดส่ง tiles become band toggles: `href` sets their band while
  clearing `overdue` (`band === key ? null : key` — re-tapping the active tile clears it back to
  ทั้งหมด); `active` = `!filter.overdue && filter.band === key`. The เกินกำหนด tile's
  href/active/tone are UNCHANGED — exactly the existing chase toggle
  `buildWorklistQuery({ ...filter, overdue: !filter.overdue })` / `filter.overdue` /
  danger-when-`overdue > 0 || filter.overdue`. The ค้างจ่าย tile stays static (`href: null`).
- **Component** `WorklistKpiTile`: NO change — it already renders any tile with an `href` as a
  `<Link>` with a pressed ring when `active` (U2 built this for the เกินกำหนด tile); the two new
  band tiles flow through the same branch.
- **Wire** `src/app/requests/page.tsx`: pass `filter` to `buildWorklistKpis` (drop the inline
  `overdueHref`/`overdueActive` args); update the now-stale "only the เกินกำหนด tile is a filter
  toggle" comment to note all three pipeline tiles toggle.

## Out of scope / seams

Making the รอสั่งซื้อ / กำลังจัดส่ง KPI tiles clickable filters (the mock does) is now done
(U4). Site (non-procurement) view unchanged.
No new query (reuses the already-fetched `myRequests` + the existing `amountById` read). No
schema, no money-exposure change (procurement already sees amounts via the grid + ค้างจ่าย).
Supplier shown is the request's `supplier` field (no PO join).

## Verification

lint · typecheck · test (incl. the new `overdue-attention` helper tests) green. App-only → no
db:push. UI is auth-gated (procurement) → verified-by-checklist; the pure helper carries
correctness; operator device pass is acceptance.
