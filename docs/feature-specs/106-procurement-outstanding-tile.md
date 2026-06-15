# Spec 106 — Outstanding-PO ฿ tile on the buyer summary

**Status:** COMPLETE (2026-06-15; no DB change; acceptance = procurement-user phone).
**Driver:** complete the spec-105 buyer summary — the deferred outstanding-฿ tile.

## What ships (app-only)

- **`procurement-pipeline.ts`** — pure `sumOutstanding(rows)` (sum non-null amounts).
- **`/requests/page.tsx`** — for procurement, an admin-client read of `amount` for the **in-transit**
  request ids (purchased/on_route — committed, not yet received), summed → a 4th summary tile
  **ค้างจ่าย** (฿). The strip is now 2×2 (รอสั่งซื้อ · กำลังจัดส่ง · เกินกำหนด · ค้างจ่าย).

## Money posture

`amount` is money (not in the list columns; read via the admin client elsewhere). The admin read here
is **gated to the procurement branch** (`if (isProcurement)`) — it never runs for SA/PM on this page,
and procurement is back-office (it _enters_ the amounts via record_purchase), so seeing the committed
total is appropriate. No authenticated grant on `amount` is added; the admin client is the only reader.

## Tests

- `procurement-pipeline.test.ts` — `sumOutstanding` (sums non-null, empty → 0).
- /requests page = verified-by-checklist (the admin read is role-gated; the sum is unit-tested).
- 777 unit / lint / typecheck / build green.

## Seams (recorded)

- `ค้างจ่าย` counts only POs where a price was recorded (amount optional, spec 103) — partial until
  prices are entered consistently.
- Buyer summary complete; next procurement-UX piece = per-supplier open-POs + spend (spec 107).
