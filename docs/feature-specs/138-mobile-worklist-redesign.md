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
- **U3 — scrollable status-chip filter with live counts** (later): replace the procurement
  status `<select>` with horizontally-scrollable pills (ทั้งหมด / อนุมัติแล้ว / กำลังจัดส่ง /
  เกินกำหนด) each showing a live count.

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

## Out of scope / seams

U3 above. Making the รอสั่งซื้อ / กำลังจัดส่ง tiles clickable filters (the mock does) needs the
band→status filter mapping that U3 introduces — deferred. Site (non-procurement) view unchanged.
No new query (reuses the already-fetched `myRequests` + the existing `amountById` read). No
schema, no money-exposure change (procurement already sees amounts via the grid + ค้างจ่าย).
Supplier shown is the request's `supplier` field (no PO join).

## Verification

lint · typecheck · test (incl. the new `overdue-attention` helper tests) green. App-only → no
db:push. UI is auth-gated (procurement) → verified-by-checklist; the pure helper carries
correctness; operator device pass is acceptance.
