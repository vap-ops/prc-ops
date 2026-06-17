# ADR 0054 — First-class deliveries (a PO ships in deliveries procurement arranges)

- Status: Accepted (2026-06-17). Operator decision: build the Delivery entity, with
  an implicit default delivery so the common case stays one-tap.
- Amends / reverses: **ADR 0053 §"why not — per-delivery receipt entity"**, which
  deferred a deliveries table as "courier-era, over-built; reconsidered when Lalamove
  lands." Reconsidered now (below). Builds on / supersedes parts of spec 134
  U5 (receive), U7 (`delivery_batch_id`), U9 (การจัดส่ง section). Implemented by
  spec 135.
- Context: across many turns the operator's model centered on **Delivery as a real
  thing procurement arranges** ("1 PO is N deliveries", "procurement arranges the
  delivery + provides proof", "why is it รับของ not Delivery"). The implicit batch
  model (U7: `delivery_batch_id` stamped at receipt by site) can't represent a
  delivery procurement **plans before it arrives**, and leaves per-delivery
  proof/cost/ETA homeless. A first-class delivery fixes that AND is the manual-first
  foundation for Lalamove (ADR/spec U4b: a courier order = one delivery).

## Why reverse ADR 0053's deferral

0053 was right that a heavyweight delivery/receipt entity wasn't worth it _just to
mark whole tickets delivered_. Three things changed the calculus: (1) the domain
genuinely has procurement-arranged deliveries (operator, repeatedly); (2) per-delivery
**proof** (vs a flat PO pile), **cost** (the deferred "sometimes paid, sometimes
free" fee), and **ETA** need a home; (3) it's not extra scope vs U4b — it **is** U4b
phase 1 (manual deliveries now → Lalamove dispatch onto the same object later). The
0053 over-build risk is contained by the implicit-default guardrail (decision 3).

## Decisions

1. **New entity `purchase_order_deliveries`.** A delivery is one shipment of a subset
   (or all) of a PO's lines, arranged by the back office. Columns: `id`,
   `purchase_order_id` (FK), `eta` (date, null), `note` (text, null), `cost` (numeric,
   null — shipping fee; null = free/unknown; **money** — admin-read/back-office
   posture like `amount`), `carrier` (text, null — future Lalamove/courier),
   `created_by`, `created_at`, `updated_at`. **No stored status** — derived (decision 5).

2. **`purchase_requests.delivery_id`** (FK → deliveries, null only transiently)
   **supersedes `delivery_batch_id`** (U7). A line belongs to exactly one delivery.
   `delivery_batch_id` is dropped/retired in the migration.

3. **The default delivery is auto-created — the 85% never touch it.**
   `create_purchase_order` also inserts **"delivery 1" = all the PO's lines** (carries
   the PO's eta). Existing POs are **backfilled** (one delivery per distinct
   `delivery_batch_id` group + a remainder delivery for unbatched lines; for the
   common single-delivery PO that's just one delivery). Result: every PO always has
   ≥1 delivery → **one uniform render path**, no ceremony for whole-PO arrivals.
   Procurement only acts to **split** into additional deliveries (the 15%).

4. **Procurement creates/splits deliveries; site does NOT.** A guarded SECURITY
   DEFINER RPC reassigns selected lines into a new delivery (with its eta/note/cost).
   Role gate = back office **incl. procurement** (they arrange delivery + provide
   proof — ADR-0053-aligned; distinct from รับของ, which stays site-only per U8).

5. **Delivery status is DERIVED** from its member lines via the existing
   `derivePurchaseOrderStatus` (open/ordered/in_transit/partially_received/received) —
   no stored status, no drift (mirrors the PO roll-up). A delivery is "received" when
   all its active lines are delivered.

6. **Proof attaches per-delivery.** `purchase_order_attachments` gains `delivery_id`
   (null = PO-general). The `proof_of_delivery` doc ties to a delivery (the default
   delivery for the 85%). Procurement uploads it (unchanged role posture).

7. **Receipt unchanged in spirit (U8):** site marks รับของ on a delivery's lines;
   **planned ≠ actual** is handled by the within-ticket split (U3) — a delivery can be
   partially received, and a line that arrives short splits, the remainder staying
   on-route in its delivery (or moved to a new delivery — UI detail for spec 135).

## Why not the alternatives

- **Lazy/virtual default (null `delivery_id` = the implicit whole-PO delivery).**
  Less data, but two render paths (PO-level vs delivery rows) — the
  consistency/branching mess the operator explicitly fears. Rejected for auto-create
  (decision 3): one path, every delivery a real row (better for the AI-driven future
  too — agents read deliveries uniformly).
- **Stored delivery status.** Drifts from the member lines. Rejected — derive
  (decision 5).
- **Keep `delivery_batch_id` (receipt-time grouping).** Can't represent a delivery
  procurement plans before arrival; no home for cost/eta/proof per delivery. Rejected
  — promote to the entity (decision 2).

## Consequences

A new mutable domain table + an FK (superseding `delivery_batch_id`) + an
auto-create + backfill migration + a create/split RPC + the per-delivery proof FK.
Spec 134 U5/U7/U9 are re-pointed at deliveries (the การจัดส่ง section becomes the
deliveries list; receipt ties to a delivery). Phased build = **spec 135** (U1 data
layer + backfill; U2 การจัดส่ง renders deliveries; U3 procurement split-delivery UI;
U4 per-delivery proof). U4b (Lalamove) later dispatches a delivery + auto-fills its
proof. Migrations under the change-management gate; pgTAP per unit.
