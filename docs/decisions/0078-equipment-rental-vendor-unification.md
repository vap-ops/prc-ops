# ADR 0078 — Equipment rental: vendor unification and full cost model

**Status:** Proposed (design approved by operator 2026-07-07; build not started) ·
**Spec:** [275](../feature-specs/275-equipment-rental-vendor-agreements.md) ·
**Amends** [ADR 0055](0055-equipment-tracking-and-rental-model.md) (decisions 3 and 7
superseded; 5 and 6 retained and extended).

## Context

ADR 0055 modelled equipment rental as an **intercompany** arrangement: a sister
company (PRI) both **owns/invests in** the assets and is a **system user** that needs
an owner-facing ROI portal. That framing produced three structural choices — a
dedicated `equipment_owners` master (decision 3), an owner portal on an `owner_id`
axis reusing ADR 0051 (decision 7), and a GL payable keyed to the owner party
(`post_rental_batch_to_gl` credits **2120 AP-intercompany**).

Two things have since changed:

1. **PRI's architecture moves to a separate application** (operator, 2026-07-07).
   PRI's fleet register, utilization, and ROI view will be built and owned **there**,
   not in prc-ops. From prc-ops's perspective PRI is **just another rental vendor** —
   there is no owner/investor identity to model here and no owner portal to serve.

2. **Real rentals are not a single monthly number.** A rental is a metered service
   purchase from a vendor with a rate structure (daily/weekly/monthly tiers, minimum
   period), one-time fees (delivery, pickup, cleaning, insurance), time overruns
   (overtime, extension), a **refundable deposit**, **Input VAT**, and Thai **5%
   withholding tax on rent**. The shipped model (`equipment_rental_batches.monthly_rate`
   only) has no slot for any of these, and posts the monthly rate **gross, with no VAT
   split**.

The 2026-07-07 seam sweep confirmed the current ground truth: rental **GL posting
already exists** (`post_rental_batch_to_gl`, enqueue trigger, live drain route — Dr
1400 WIP / Cr 2120); `equipment_rental_batches` + `equipment_project_allocations` are
**dormant** (no UI, no call sites — only generated types + orphan validators); the
per-WP **usage/check-out layer is LIVE** (`wp-equipment-zone.tsx`, `wp_equipment_sell`,
`wp_profit` fold); the **WHT engine exists and is unwired for rentals** — `wht_certificates`,
`record_wht_certificate`, and `post_wht_certificate_to_gl`, with the `wht_rates` seed at
rent = 5%; `suppliers` has **no status column**; and **no vendor-invoice / settlement
object exists anywhere**.

## Decision

**Generalize rental away from the intercompany special case: the rental payee is an
ordinary `suppliers` vendor, the rental agreement is a standalone object (the activated
`equipment_rental_batches` stack, not a PO line), the vendor invoice reconciles through
a new manual settlement object with a variance roll-up, and the full cost model
(deposit, VAT, WHT, one-time fees, overtime, rate tiers, minimum period) lands on the
vendor/inbound side while the WP transfer-price stays flat.**

1. **Vendors unify on `suppliers` (supersedes ADR 0055 decision 3).** The rental
   agreement names a `suppliers` row as its **payee**. `equipment_owners` is retired as
   the payee master. To reach vendor parity, `suppliers` gains `contact_status`
   (blacklist parity with contractors/service_providers), `tax_id`, and
   `is_vat_registered`. Existing `equipment_owners` rows migrate into `suppliers`. The
   live `equipment_items.owner_id` / `equipment_rental_batches.owner_id` FKs are
   **deprecated additively** — a new `supplier_id` is added and backfilled; `owner_id`
   is left in place, unused, and dropped only in a later destructive cleanup migration
   (operator-held). This keeps the unification within the additive-migration lane.

2. **The GL payable moves to trade AP (amends the decision-5 posting).**
   `post_rental_batch_to_gl` credits the **trade AP account (2100)**, party = supplier,
   not the intercompany account (2120). PRI is no longer a special counterparty.

3. **No owner portal in prc-ops (supersedes ADR 0055 decision 7).** The `owner_id`
   external-access axis and the ADR 0051 owner-portal reuse are **dropped from this
   application**. PRI's ROI view lives in PRI's own app. prc-ops records only what it
   pays a vendor and what it charges its own WPs.

4. **Case A transfer pricing is retained (ADR 0055 decision 5, unchanged).** WPs are
   charged an independent, PRC-set `daily_rate` (a transfer price), computed live by
   `wp_equipment_sell`, **not** a pass-through split of the vendor cost. PRC's equipment
   margin = Σ WP daily charges − vendor cost. The check-out/check-in field surface and
   its rate-free posture are unchanged.

5. **Cost-shape complexity lands on the vendor side; the WP charge stays flat.** Rate
   tiers, minimum period, and overtime describe **what PRC pays the vendor**, captured on
   the agreement and its settlement. They do **not** alter the flat per-item
   `daily_rate` the WP is charged. This preserves the shipped WP surface and keeps money
   complexity in the back office.

6. **Rental is a standalone agreement, not a PO/PR line.** Rental is round-trip
   (returned, not consumed), metered daily, quantity-1, two-tier (agreement cost +
   transfer price), and carries an immutable `daily_rate_snapshot` — six invariants the
   line-grain PR/PO model breaks. The agreement is the **activated
   `equipment_rental_batches` stack** (extended with the fields below), following the
   `subcontracts` agreed-vs-paid precedent. A PO/attachment may reference it as a source
   document only; cost and custody stay orthogonal to PR/PO lineage.

7. **A new manual settlement object reconciles committed vs actual (variance
   roll-up).** No vendor-invoice object exists today. A new append-only + supersede
   `rental_settlements` records the vendor's actual invoice (base + overtime + fees, with
   Input VAT and WHT; the refundable deposit is a separate asset, resolved at return),
   posts GL at that point (subcontract-payment
   pattern), and drives a read-only variance roll-up — Σ charged-to-WP (`wp_equipment_sell`)
   vs Σ paid-to-vendor, overpay flagged as subcontracts do. Automatic plan-vs-actual
   reconciliation (spec 271 reuse) is **deferred to v2** — it needs an uncoded
   classification library and a WP-grain generalization.

8. **Full cost model — money-correctness is v1, wet-rental is deferred.** In v1:
   refundable **deposit** (a prepaid asset — Dr the deposit account 1320 at inception,
   released/forfeited at return; account 1320 to be seeded), **Input VAT** split on the
   rental cost (Dr the Input VAT account 1300; requires `suppliers.is_vat_registered`),
   **WHT 5%** issued via the existing `record_wht_certificate` engine (Cr the WHT
   account), **one-time fees** (delivery/pickup/cleaning/insurance) via a rental-charges
   table mirroring `purchase_order_charges` (spec 260), and **time overruns** (overtime
   as a settlement line, rate tiers, minimum period). **Deferred to v2:** with-operator
   (wet) rental and fuel, per-item deposit/return grain, metered-hourly overtime, the
   frozen `wp_equipment_costs` + WP-dimensioned GL (ADR 0055 decision 5's freeze), and
   any purchase-plan integration of rental demand.

The binding money posture (ADR 0055 decision 6) is unchanged: every ฿ field is
zero-authenticated-grant, read only via the admin client behind
`requireRole(pm/super/procurement)`, never on a site_admin-reachable screen, audited;
rates are snapshotted at entry and never rewritten.

## Consequences

- **Simpler here, richer there.** prc-ops sheds the owner/investor axis and portal
  (they belong to PRI's app), and gains a realistic vendor cost model. One vendor master
  (`suppliers`) instead of two.
- **A live-table migration with care.** `suppliers` gains columns and
  `equipment_items`/`equipment_rental_batches` gain `supplier_id`; the migration is
  additive (owner FKs deprecated, not dropped) so it stays inside the self-merge
  additive lane. The destructive `owner_id` drop and any `equipment_owners` teardown are
  a separate operator-held cleanup.
- **The dormant stack finally activates.** `equipment_rental_batches` +
  `equipment_project_allocations` get their first UI and server actions; the GL wiring
  they already carry is repointed (2120 → 2100), not rebuilt.
- **New settlement surface + VAT/WHT/deposit GL legs.** A first-class vendor-invoice
  object and the deposit/VAT/WHT postings are new; the WHT engine is reused, not rebuilt.
- **Exact COA codes are confirmed at build.** The account numbers cited (1300, 1320,
  2100, WHT payable) are from the seam sweep and are re-verified against the seeded chart
  in the settlement unit; 1320 is seeded there if absent.
- **v2 backlog is explicit** (decision 8): wet rental, fuel, per-item grain, metered
  overtime, frozen WP cost + WP-grain GL, purchase-plan rental demand, and auto
  plan-vs-actual reconciliation.
