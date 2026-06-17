# Spec 135 — First-class deliveries (a PO ships in deliveries procurement arranges)

- Status: Draft (2026-06-17). Decided in ADR 0054 (amends/reverses ADR 0053).
- Builds on / re-points spec 134 U5 (receive), U7 (`delivery_batch_id`), U9
  (การจัดส่ง section). Operator decisions (2026-06-17): build the entity; the default
  delivery is **implicit/auto** so the 85% whole-PO case stays one-tap.

## Problem

The implicit batch model (U7: `delivery_batch_id` stamped at receipt) can't represent
a delivery **procurement plans before it arrives**, and per-delivery proof / cost /
ETA have no home. The operator's domain has Delivery as a first-class noun procurement
arranges; this promotes the batch to that entity — manual-first, the foundation U4b
(Lalamove) dispatches onto. Full rationale: ADR 0054.

## Model (ADR 0054)

`purchase_order_deliveries` (id, purchase_order_id, eta, note, cost [money,
back-office], carrier [future], created_by, …). `purchase_requests.delivery_id` FK
supersedes `delivery_batch_id`. Status DERIVED from member lines
(`derivePurchaseOrderStatus`). Proof ties to a delivery
(`purchase_order_attachments.delivery_id`). The default delivery is auto-created
(= whole PO) so every PO has ≥1 delivery → one render path, no ceremony for the 85%.
Procurement creates/splits deliveries; site receives against them (รับของ stays
site-only, U8); planned≠actual handled by the U3 split.

## Units (one per session; data layer first)

- **U1 — data layer.** `purchase_order_deliveries` table + RLS (SELECT back-office,
  no direct write — RPC-only, ADR 0038) + `purchase_requests.delivery_id` FK;
  `create_purchase_order` also creates "delivery 1" = all lines (carries po.eta);
  **backfill** existing POs (one delivery per `delivery_batch_id` group + a remainder
  delivery; retire `delivery_batch_id`); a `deliveryStatus` helper (reuse
  `derivePurchaseOrderStatus` over a delivery's member statuses); pgTAP. No UI.
- **U2 — การจัดส่ง renders deliveries.** The U9 section becomes the **deliveries list**:
  per delivery — งวดที่ N, eta, derived status pill, cost (back-office), its lines,
  and its proof. The U7 receipt-batch breakdown is replaced by the delivery list
  (a single-delivery PO shows one entry = today's simple view).
- **U3 — procurement split-delivery UI.** A "แยกการจัดส่ง / สร้างงวดจัดส่ง" action
  (bottom sheet, spec 78): select lines + eta + note + cost → a guarded RPC moves them
  into a new delivery. Back-office incl procurement; site never creates. Implicit
  default means this is only used for the multi-delivery 15%.
- **U4 — per-delivery proof.** `purchase_order_attachments.delivery_id`; the
  proof_of_delivery uploader + gallery scope to a delivery (default delivery for the
  85%). `PROOF_OF_DELIVERY_LABEL` reused.
- **(U4b, later — blocked on Lalamove creds):** dispatch a delivery via Lalamove +
  auto-fill its proof/cost; the delivery entity is the join point.

## Out of scope / seams

Editing a delivery's line set after receipt; merging deliveries; deleting a delivery
(append-only posture — a wrong split is corrected by re-splitting). Cross-instance.

## Verification

Per unit: lint · typecheck · test green; U1 also pgTAP + the backfill proven
(existing POs each get ≥1 delivery, lines assigned, no orphan). Migrations under the
change-management gate (migration + reviewed PR + operator db:push).
