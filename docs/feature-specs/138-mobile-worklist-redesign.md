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

- **U1 — "ต้องติดตามด่วน" urgent-follow-up panel.** The mock's headline addition: an inline
  card listing the actual overdue deliveries (not just the เกินกำหนด count), each row tapping
  straight into the request detail, with a footer link to the full overdue (chase) filter.
  THIS UNIT.
- **U2 — KPI hero restyle** (later): the รอสั่งซื้อ tile as an amber-gradient hero with an
  icon + subtitle; the four tiles gain icons and tap-to-filter parity with the mock.
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

## Out of scope / seams

U2/U3 above. Site (non-procurement) view unchanged. No new query (reuses the already-fetched
`myRequests` + the existing `amountById` read). No schema, no money-exposure change (procurement
already sees amounts via the grid + ค้างจ่าย). Supplier shown is the request's `supplier` field
(no PO join).

## Verification

lint · typecheck · test (incl. the new `overdue-attention` helper tests) green. App-only → no
db:push. UI is auth-gated (procurement) → verified-by-checklist; the pure helper carries
correctness; operator device pass is acceptance.
