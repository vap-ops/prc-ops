# Spec 104 — Procurement worklist as a buyer's pipeline

**Status:** COMPLETE (2026-06-15; no DB change; acceptance = procurement-user phone).
**Driver:** the "procurement UX" discussion — #1 priority. Procurement is a pipeline operator
(approved → order → track → receive); the shared /requests worklist wasn't ordered around that.

## What ships (app-only)

- **`src/lib/purchasing/procurement-pipeline.ts`** (pure) — `procurementBand(status)` →
  `to_order` (approved) · `in_transit` (purchased/on_route) · `received` (delivered/site_purchased) ·
  `awaiting_approval` (requested); rejected/cancelled → null (excluded). `PROCUREMENT_BANDS` (display
  order, `to_order` is the one `hot` band) + `groupByProcurementBand(rows)` (band order, drops empty
  bands + unbanded rows, preserves input order).
- **`/requests/page.tsx`** — for `ctx.role === "procurement"` the list renders as banded sections
  (รอสั่งซื้อ first, hot/amber header + count; then กำลังจัดส่ง / ได้รับแล้ว / รออนุมัติ) instead of the
  flat pending-first list. Extracted a shared `cardFor(r)` closure so the flat (PM/SA) list and the
  banded (procurement) list render identical cards — **PM/SA output unchanged**. The ของฉัน filter is
  hidden for procurement (it never owns a request). No data-fetch change (same queries/RLS).

## Why these bands

They map 1:1 to the buyer's action: รอสั่งซื้อ = record a purchase; กำลังจัดส่ง = record shipment /
track ETA; ได้รับแล้ว = file the invoice; รออนุมัติ = waiting on the PM (visibility only, can't act).

## Tests

- `procurement-pipeline.test.ts` — status→band mapping, exclusions, hot band, grouping order/dedup.
- /requests page = verified-by-checklist (the pure grouping carries the logic test; cards unchanged).
- 772 unit / lint / typecheck / build green.

## Seams (recorded)

- **Filing-gap band** (รอแนบใบเสร็จ — delivered but no invoice) deferred: needs an invoice-attachment-
  presence query per row. v1 folds those into ได้รับแล้ว.
- Within-band order is the page's existing order (pending priority-sorted, decided newest-first); a
  FIFO "oldest-approved-first" buy queue for `to_order` is a refinement.
- Other procurement-UX pieces from the discussion still open: a buyer overview (pipeline counts +
  overdue ETAs + outstanding PO value), per-supplier open-POs + spend, price history.
