# Spec 107 — Per-supplier spend on the suppliers screen

**Status:** COMPLETE (2026-06-15; no DB change; acceptance = procurement-user phone).
**Driver:** procurement-UX vision — supplier intelligence ("finish the 2", 2/2).

## What ships (app-only)

- **`src/lib/purchasing/supplier-spend.ts`** (pure) — `aggregateSupplierSpend(prs)` →
  `Map<supplier_id, { spend, open }>`: `spend` = Σ amount over committed POs (in-transit + received);
  `open` = in-transit PO count. Site purchases carry no supplier_id, so they never count.
- **`record-manager.tsx`** — `RecordBadge` tone gains `"neutral"` (a plain info chip, not a warning)
  - its render (`bg-sunk text-ink-secondary`). Backward-compatible (amber/red unchanged).
- **`contacts-tabs.tsx`** — new optional `supplierBadge(id)` prop → the suppliers `RecordManager`'s
  `rowBadge`.
- **`/contacts/vendors/page.tsx`** — for **procurement** only: an admin-client read of committed
  purchase_requests (`supplier_id, amount, status`; bounded to purchased/on_route/delivered),
  aggregated, exposed as a per-row chip — e.g. **฿12,500 · 2 ค้างส่ง** (spend · open POs). PM/super
  vendors view unchanged.

## Money posture

`amount` is money → admin read, **gated to the procurement branch** (`if (!isManager)` on a
BACK_OFFICE-gated page; SA can't reach it). Procurement is back-office (it records the purchases), so
seeing supplier spend is appropriate. No authenticated grant on `amount` added.

## Tests

- `supplier-spend.test.ts` — committed-only aggregation, open count, supplier-less rows ignored,
  rejected/requested ignored, empty.
- /contacts/vendors page = verified-by-checklist (admin read role-gated; aggregation unit-tested).
- 780 unit / lint / typecheck / build green.

## Seams (recorded)

- Spend reflects only **priced** POs (amount optional, spec 103) — partial until prices entered.
- Aggregation fetches committed rows + sums in JS; a SQL `group by supplier_id` (RPC/view) is the
  scale refinement if committed history exceeds the PostgREST row cap.
- PM/super don't get the spend chip (procurement-only v1); price-history is a further step.
