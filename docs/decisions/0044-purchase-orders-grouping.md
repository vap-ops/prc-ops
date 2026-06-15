# ADR 0044 — Purchase orders: grouping tickets into a supplier order

- Status: Accepted (2026-06-16)
- Context: operator asked how admins handle a purchase that covers **more than one
  ticket** (one supplier order spanning several `purchase_requests`) and how
  **partial delivery** works in that case. Today the only procurement entity is
  `purchase_requests` — one ticket = one item line, one work package, one
  quantity, delivered atomically. There is **no purchase-order object**: a buyer
  ordering five tickets from one supplier records the purchase five times, and the
  per-ticket `amount` means one supplier invoice total has to be split by hand.
  Partial delivery _across_ tickets already works (each ticket delivers
  independently) but isn't grouped; partial delivery _within_ one ticket (split
  quantity) is out of scope here (a later receipts unit).

## Decisions

1. **New `purchase_orders` entity** groups N approved `purchase_requests` into one
   supplier order. Columns: `id`, `po_number` (own sequence, mirrors
   `pr_number`), `supplier_id` (FK `suppliers`), `supplier` (text snapshot, the
   spec-33 pattern), `eta` (date), `ordered_at` (timestamptz), `notes` (text,
   ≤2000 — notes-everywhere), `created_by` (FK users), `created_at`,
   `updated_at`.

2. **`purchase_requests.purchase_order_id`** — nullable FK → `purchase_orders(id)`.
   A ticket belongs to 0 or 1 PO. One-off purchases (no PO) keep the existing
   single-ticket `record_purchase` path unchanged.

3. **Amount stays per-ticket** (operator decision): each member `purchase_request`
   keeps its own `amount`; the PO total is the **sum** (computed, not stored). This
   preserves per-WP material spend (specs 100/103/106 read `amount` per ticket).
   `purchase_orders` carries **no money column** — money stays on the line, under
   the existing admin-read/procurement-gate posture (no new authenticated grant).

4. **Creation = one atomic SECURITY DEFINER RPC** `create_purchase_order(
p_supplier_id, p_eta, p_lines jsonb)` where `p_lines = [{request_id, amount}]`:
   role-gates the caller to back-office (`project_manager`/`super_admin`/
   `procurement`) via `current_user_role()` on the **authenticated session** (not
   the admin client — the spec-68 lesson: a role-gated DEFINER RPC must run on the
   user session so `auth.uid()` is non-null); inserts the PO; then for each line
   guards `status = 'approved'`, and sets `amount`, `supplier` (snapshot from the
   chosen supplier), `eta`, `purchased_at = now()`, `status = 'purchased'`,
   `purchase_order_id`. All-or-nothing in one transaction. Writes one audit row
   per line (reusing the `purchase` action) plus a PO-create audit row. Mirrors
   `record_purchase` semantics per line (coalesce-preserve not needed — these are
   approved→purchased first writes).

5. **Shipping + delivery stay per-ticket.** `record_shipment` and the
   confirmation-photo auto-delivery (spec 24) are unchanged and operate on
   individual member tickets — so a PO that arrives in parts is handled by
   delivering the tickets that arrived. The **PO status is derived** (pure helper,
   not stored — no drift) from its members: `open` (none purchased yet) → `ordered`
   (all purchased, none delivered) → `partially_received` (some delivered) →
   `received` (all delivered). rejected/cancelled members are excluded from the
   roll-up.

6. **RLS.** `purchase_orders` SELECT mirrors `purchase_requests` (site-wide for
   `site_admin`/`project_manager`/`procurement`/`super_admin`, ADR 0026); there is
   **no direct INSERT/UPDATE policy** — the only writer is the SECURITY DEFINER
   RPC (the fact-column posture, ADR 0038). `appsheet_writer` is unaffected
   (`current_user_role()` is NULL for it).

7. **Out of scope (recorded seams):** partial receipt _within_ a single ticket
   (split quantity → a receipts/`quantity_received` unit); cross-instance/tenancy
   (instance-per-customer, ADR 0035); editing a PO's line set after creation
   (v1 = create-then-individual-line-ops). PO PDF.

## Why not the alternatives

- **Lightweight `order_ref` text tag** (the latent unused column): no PO-level
  fields, no integrity, no clean grouping or status roll-up. Rejected — a
  first-class entity is the honest model and the operator wants real grouping.
- **PO-level lump amount**: would break per-WP material-spend attribution for
  grouped buys. Rejected (decision 3).
- **Stored PO status**: drifts from the member lines (the source of truth).
  Rejected in favour of a derived roll-up.

## Consequences

A new mutable domain table + one FK + one creation RPC + per-WP spend preserved.
The build is phased: **spec 115 = data layer** (table, FK, RLS, RPC, helpers,
pgTAP); **spec 116 = UI** (multi-select bundling in the grid, the create-PO form
with per-line prices, grouped display, PO context in the review drawer). The
migration applies under the operator gate (change-management policy).
