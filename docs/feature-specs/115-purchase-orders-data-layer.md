# Spec 115 — Purchase orders: data layer (phase 1)

**Status:** PLANNED (design locked; build pending — schema migration behind the operator gate).
**ADR:** 0044. **Driver:** group multiple approved tickets into one supplier order (operator
decision: one PO = many tickets; **per-ticket prices**, PO total = sum, so per-WP material spend
stays exact). Phase 1 = the data layer; phase 2 (spec 116) = the UI.

## What ships (phase 1 — SCHEMA, operator-gated)

- **Migration** `purchase_orders` table (per ADR 0044 §1): `po_number` sequence, `supplier_id` FK,
  `supplier` snapshot, `eta`, `ordered_at`, `notes` (CHECK ≤2000), `created_by`, timestamps. RLS:
  SELECT mirrors `purchase_requests` (site-wide back-office, ADR 0026); **no direct INSERT/UPDATE**
  (RPC-only writer). Grants minimal; `appsheet_writer` unaffected.
- **Migration** `purchase_requests.purchase_order_id` nullable FK → `purchase_orders(id)`.
- **RPC** `create_purchase_order(p_supplier_id, p_eta, p_lines jsonb)` SECURITY DEFINER (ADR 0044
  §4): back-office role gate on the **authenticated session**; insert PO; per line guard
  `status='approved'` then set amount/supplier/eta/purchased_at/status='purchased'/purchase_order_id;
  atomic; one `purchase` audit row per line + a PO-create audit row.
- **Pure helpers** (`src/lib/purchasing/purchase-order.ts`): `derivePurchaseOrderStatus(memberStatuses)`
  → open|ordered|partially_received|received (ADR 0044 §5); `purchaseOrderTotal(lineAmounts)` → sum.
- **`database.types.ts`** hand-extended then `db:types` reconciled.
- **pgTAP**: `purchase_orders` exists + columns + RLS (back-office SELECT, no authenticated
  INSERT/UPDATE) + the FK; `create_purchase_order` signature + behaviour (bundles approved lines →
  purchased, stamps PO, sums; refuses a non-approved line; role-gated).

## Scope

- **IN:** the table, the FK, the RPC, the status/sum helpers, RLS, pgTAP, types. The write capability.
- **OUT (spec 116):** all UI — multi-select bundling in the grid, the create-PO form (per-line
  prices), grouped display, PO context in the drawer. Also out (later units): within-ticket partial
  receipts, PO line-set editing, PO PDF.

## Money posture

Unchanged. Amount stays on the ticket (admin-read, procurement-gated); `purchase_orders` has no money
column; the PO total is computed by `purchaseOrderTotal`. No new authenticated amount grant.

## Tests

- **TDD:** `tests/unit/purchase-order.test.ts` first — status roll-up (open/ordered/partial/received,
  rejected+cancelled excluded) + total sum.
- pgTAP for the table/RLS/RPC (above). Suites baseline ~832 unit / 1025 pgTAP.

## Acceptance (phase 1)

`create_purchase_order` bundles approved tickets into a PO (each line → purchased, priced, stamped),
refuses a non-approved line, is back-office-gated; per-WP spend still reads each line's amount;
pgTAP green. No user-visible change yet — that's spec 116.

## Seams

- PO status is derived, never stored (no drift).
- Editing a PO's line set after creation, within-ticket partial receipts, PO PDF — later.
