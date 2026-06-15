# Spec 120 — Unify purchase recording into PO creation

**Status:** SHIPPED 2026-06-16 (migration `20260701000300` applied to prod; 874 unit / 1076 pgTAP / lint / typecheck / build green). **ADR:** 0044/0045.
**Driver:** operator — "replace บันทึกการสั่งซื้อ with the new PO creation." Two purchase paths had
diverged (the spec-33 per-ticket `record_purchase` form vs the spec-116/119 PO flow). PO creation is the
better-built one (right-side panel, inline add-supplier, VAT, phone basket) — make it the single path.
"Every purchase is an order to a supplier = a PO."

## What ships

- **Single-ticket = a one-line PO.** On an approved request, the inline record-purchase form is replaced
  by a **"สร้าง PO" button that opens the create-PO sheet pre-seeded with that one ticket** — one tap,
  no grid hunting. A 1-line PO is fine; VAT / supplier / ETA / price / order_ref all come along.
  - **Request detail page** (`/requests/[id]`): `PurchaseRecordForm` → `CreatePoFromRequestButton`
    (a small client component; the server page passes the serializable line + suppliers).
  - **Procurement drawer** (`procurement-grid` spec 114): the `record` action → a "สร้าง PO" button
    that closes the drawer, seeds the basket with that one record, and opens the create-PO sheet
    (reuses the grid's existing sheet machinery via an `onCreatePo` callback).
- **`order_ref` carried.** `record_purchase` captured the supplier's order/invoice reference; the PO flow
  now does too. Migration `20260701000300` DROP+CREATEs `create_purchase_order` with `+p_order_ref`
  (validated ≤80, one per PO, written onto each member ticket's existing `purchase_requests.order_ref` —
  **no new column**). The sheet gains an optional order-ref field; the action passes `p_order_ref`.
- **`PurchaseRecordForm` retired from the UI** (both usages removed). The component file + the
  `record_purchase` RPC are LEFT in place (AppSheet doesn't call the RPC; dead-code removal is a later
  cleanup). `SupplierOption` still lives in `purchase-record-form.tsx` (imported as a type).

## Scope

- **IN:** the two UI surfaces swapped to the pre-seeded PO sheet; `order_ref` on the PO flow (migration +
  sheet + action); pgTAP (order_ref stored) + the sig pins; the sheet test (order_ref in the payload).
- **OUT:** removing `PurchaseRecordForm` the file + the `record_purchase` RPC (later cleanup); any change
  to the AppSheet write path.

## Money posture

Unchanged. amount = gross, vat_rate + order_ref ride the existing RPC posture (RPC-write, procurement/
admin-read, never site_admin).

## Acceptance

On an approved request (detail page or procurement drawer), the buyer taps "สร้าง PO" → the sheet opens
pre-loaded with that ticket → supplier / VAT / ETA / price / order_ref → creates a one-line PO; the
ticket becomes purchased. No more separate record-purchase form. pgTAP green.
