# Spec 116 — Purchase orders: create-PO UI (phase 2)

**Status:** SHIPPED 2026-06-16 (860 unit / lint / typecheck / build green; no schema). **ADR:** 0044. **Depends on:** spec 115 (the data layer
— `purchase_orders` table + `create_purchase_order` RPC + `derivePurchaseOrderStatus` /
`purchaseOrderTotal` helpers, all shipped). **Driver:** spec 115 shipped the engine but there is NO
way to create a multi-ticket PO from the app; this is that screen.

## What ships (phase 2 — UI, no schema)

The buyer (procurement / PM / super) selects several **approved** tickets on the procurement worklist,
picks one supplier, enters each line's price + an ETA, and creates ONE purchase order — calling the
existing `create_purchase_order` RPC, which bundles the tickets (each → purchased, priced, stamped,
snapshotted, linked to the PO) atomically.

- **Multi-select on the desktop grid** (`procurement-grid.tsx`, `lg:` only — the buyer works on
  tablet/PC, spec 108). A checkbox on each **`to_order`** row (status `approved`, `purchased_at`
  null — the only bundleable rows). A sticky toolbar appears when ≥1 row is selected: `สร้าง PO (n)`
  - a clear button. Rows in other bands are never selectable.
- **Create-PO sheet** (`BottomSheet`): a supplier `<select>` (the existing `SupplierOption` list the
  page already fetches for procurement), an ETA date input, and the selected lines — each line shows
  its PR number + item + qty/unit and a **price input** (฿, optional, must be > 0 if entered), with a
  **live total** (`purchaseOrderTotal`). Submit → `createPurchaseOrder` action.
- **Server action** `createPurchaseOrder({ supplierId, eta, lines })` in `src/app/requests/actions.ts`
  — runs on the **authenticated user session** (the RPC is role-gated on `current_user_role()`, so it
  must NOT use the admin client), validates input, calls `supabase.rpc("create_purchase_order", …)`,
  maps `42501`/`P0001` to Thai messages, `revalidatePath("/requests")`, returns `{ ok, poId }`.
- **Pure validator** `validateCreatePurchaseOrder` (mirrors `validateRecordPurchase`): ≥1 line, a
  supplier, each amount null-or-positive-number, eta null-or-valid-date. The RPC re-guards everything
  server-side (approved-only lines, supplier exists, atomic) — the validator is the fast client/server
  pre-check, not the authority.

## Scope

- **IN:** desktop grid multi-select of `to_order` rows; the create-PO sheet (supplier + ETA + per-line
  prices + live total); the validator; the action; success → clear selection + close + refresh (bundled
  rows leave `to_order`, appear in `in_transit`).
- **OUT (deferred, follow-up spec):** the grouped PO display (showing a PO + its member tickets as a
  group) and PO context inside the per-record review drawer; PO line-set editing; PO PDF; phone
  multi-select (the buyer bundles on tablet/PC — recorded). A cross-project bundle is **allowed** (a
  supplier order may span WPs/projects; the RPC permits it).

## Money posture

Unchanged. Per-line price entry is amount entry → procurement/back-office only (the grid + this sheet
are already procurement-gated; PM/super are back-office). No new grant; the RPC writes `amount` per
ticket as the function owner. `purchase_orders` still has no money column; the sheet's total is the
computed `purchaseOrderTotal` of the entered line prices.

## Tests

- **TDD:** `tests/unit/validate-create-purchase-order.test.ts` first (line count, supplier, amount,
  eta rules).
- Component test: the create-PO sheet renders selected lines, computes the live total, and submits the
  right `{ supplierId, eta, lines }` to a mocked action.
- The RPC behaviour is already pgTAP-covered (spec 115, file 49).
- **CAUTION (the ผู้ขาย-crash lesson):** procurement routes can't be preview-verified here (preview
  only renders `/login`), so every server→client prop MUST be serializable (no function props to the
  client grid/sheet). Acceptance = procurement user (Pattrawut) on a live PC.

## Acceptance (phase 2)

A procurement user on a PC selects 2+ approved tickets → opens สร้าง PO → picks a supplier, enters
prices + ETA → creates the PO; the tickets become purchased/priced/stamped and leave the to-order band;
per-WP spend reads each line's amount. No money on any site_admin screen.

## Seams

Grouped PO display + drawer PO-context + PO line-set editing + PO PDF + phone bundling — later units.
