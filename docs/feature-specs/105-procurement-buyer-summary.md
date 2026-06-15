# Spec 105 — Procurement buyer summary strip

**Status:** COMPLETE (2026-06-15; no DB change; acceptance = procurement-user phone).
**Driver:** procurement-UX vision #2 (buyer overview). Realized as a **summary strip on the worklist**
they already land on — not a separate screen (one glance: workload + what's slipping, then the work).

## What ships (app-only)

- **`procurement-pipeline.ts`** (extended) — `procurementSummary(rows, todayIso)` → `{ toOrder,
inTransit, overdue }`: counts of the to-order (approved) and in-transit (purchased/on_route) bands,
  plus `overdue` = in-transit rows whose `eta` is before today (Bangkok civil date, string compare).
- **`/requests/page.tsx`** — for procurement, a 3-tile strip above the pipeline bands:
  **รอสั่งซื้อ** (hot/amber) · **กำลังจัดส่ง** (neutral) · **เกินกำหนด** (red when > 0). Computed from the
  already-fetched rows + `bangkokTodayISO()`; a small `BuyerStat` tile component. No new data/RLS.

## Why no money (yet)

Outstanding-PO ฿ is deliberately **not** in v1: `amount` is money (not in the list columns, read via
admin elsewhere), so totalling it needs an admin read — out of scope for this app-only strip. The
counts + overdue come entirely from status + eta (already readable). Outstanding ฿ = a recorded seam.

## Tests

- `procurement-pipeline.test.ts` — `procurementSummary` (band counts, overdue ETA, ETA==today not
  overdue, empty → zeros).
- /requests page = verified-by-checklist (pure summary carries the logic test).
- 775 unit / lint / typecheck / build green.

## Seams (recorded)

- **Outstanding PO ฿** tile (sum of `amount` over in-transit) — needs an admin amount read; deferred.
- Tiles are static (not filters); making them filter the bands would need a client component.
- Remaining procurement-UX vision: per-supplier open-POs + spend, price history, the filing-gap band.
