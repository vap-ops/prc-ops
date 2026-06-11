# Spec 33 — In-app purchase/shipment recording + suppliers master

**Status:** locked — 2026-06-11. ADR 0038 (binding design; amends
ADR 0025/0026). Parallel path per the ADR 0034 amendment — AppSheet
write path untouched, zero AppSheet config required by this unit.

## 0. Locked design

Back office records a purchase (supplier, order ref, amount, ETA) and
a shipment directly on `/requests` cards. Two SECURITY DEFINER RPCs do
the writes; the existing derive/audit/notification triggers do
everything else. Suppliers become a master table (contractor-picker
pattern) with `purchase_requests.supplier_id` as the analytics link
and the `supplier` text column written as a name snapshot.

## 1. Scope

**In:**

- Migration A: `suppliers` table (ADR 0033 mirror: non-blank name,
  phone, created_by pin; staff SELECT incl. `procurement`; INSERT/
  UPDATE for `project_manager|procurement|super_admin`; NO delete) +
  `purchase_requests.supplier_id uuid NULL` FK.
- Migration B: `record_purchase` + `record_shipment` RPCs (role gate,
  stage guard, supplier-name snapshot, amount > 0, order_ref ≤ 80
  chars trimmed; revoke-then-grant EXECUTE).
- pgTAP file 26: suppliers shape/RLS/no-delete, RPC role + stage
  guards, end-to-end derive chain (approved→purchased→on_route),
  snapshot + FK landing, audit + outbox rows from existing triggers.
- App: `validate-record-purchase.ts` pure validator (test-first);
  server actions `createSupplier`, `recordPurchase`, `recordShipment`
  (RPC relays, decide-pattern error unions); `PurchaseRecordForm`
  (supplier select + inline เพิ่มผู้ขายใหม่ + เลขที่ใบสั่งซื้อ /
  จำนวนเงิน / คาดว่าจะได้รับของ inputs) as details-expander on
  `approved` cards; บันทึกว่าจัดส่งแล้ว confirm button on `purchased`
  cards. Both render ONLY for `project_manager|procurement|
super_admin` viewers, on `/requests` (site-wide + pinned modes).
- Status copy: the /requests footer's "back office records in
  AppSheet" sentence updated to mention both paths.

**Out (recorded seams):** field corrections after recording (stays
AppSheet-only; future audited correction RPC), bulk/grid entry mode
(ADR 0034 amendment — only if usage data demands), supplier
merge/dedup + detail pages, supplier on WP-inline request cards,
spend analytics, AppSheet supplier_id backfill.

## 2. Validation (locked)

| Field     | Rule                                                |
| --------- | --------------------------------------------------- |
| supplier  | required; must exist in `suppliers` (RPC re-checks) |
| order_ref | optional; trimmed; ≤ 80 chars; empty → NULL         |
| amount    | optional; finite number > 0                         |
| eta       | optional; `YYYY-MM-DD`                              |

Stage guards (RPC, two-layer with the form's render condition):
purchase requires `approved` + `purchased_at IS NULL`; shipment
requires `purchased` + `shipped_at IS NULL`. Violations raise `P0001`;
role violations raise `42501`; both map to Thai error strings in the
actions.

## 3. Verification checklist

- [ ] RED→GREEN: validator unit tests first; pgTAP file 26 written
      before migrations are pushed.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green.
- [ ] `pnpm db:test` green post-push; types regenerated; dry-run drift
      check before work.
- [ ] pgTAP proves the chain: `record_purchase` flips to `purchased`
      (derive), writes audit `purchase_request_purchase`, writes outbox
      `pr_progress`; `record_shipment` flips to `on_route` with the
      same chain — no new triggers anywhere.
- [ ] SA and visitor are denied by both RPCs (42501); SA cannot
      INSERT suppliers.
- [ ] /requests renders the form only for gated roles (component test
      on the render condition's pure seam; page wiring
      verified-by-checklist).
- [ ] No diff under AppSheet-facing config; `appsheet_writer` grants
      byte-unchanged.
