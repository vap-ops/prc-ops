# Spec 275 — Equipment rental: vendor-unified agreements, settlement, and full cost model

**Status:** PLANNED — design approved by operator 2026-07-07 (4 decisions + scope
locked via a grounded seam sweep). Build not started. **ADR:**
[0078](../decisions/0078-equipment-rental-vendor-unification.md) (amends ADR 0055 —
decisions 3 and 7 superseded, 5 and 6 retained). **Continues** specs
[141](141-equipment-registry-data-layer.md) (tracking), [146](146-equipment-rental-money.md)
(money spine), [202](202-equipment-usage-ui.md) (usage UI).

**Driver.** PRI (the sister company) is being generalized to _just another rental
vendor_ — its owner/ROI app is built separately (operator, 2026-07-07). That removes
the intercompany special-casing ADR 0055 was built around and, at the same time, the
current model (`equipment_rental_batches.monthly_rate` only) is too thin for real
rentals: no deposit, no VAT split, no WHT, no fees, no rate tiers / minimum period /
overtime, and no vendor-invoice reconciliation. This spec unifies the vendor onto
`suppliers`, activates the dormant rental-agreement stack, and adds the full cost model
plus a manual settlement with a variance roll-up.

**Ground truth (2026-07-07 seam sweep, verified against migrations).**

- Rental **GL posting already exists**: `post_rental_batch_to_gl`
  (`20260743000100_subledger_posters.sql`), the
  `equipment_rental_batches_enqueue_gl_posting` AFTER-INSERT trigger
  (`20260741000100`), and the live drain route (`20260813007000`) — posts **Dr 1400 WIP
  / Cr 2120 AP-intercompany** (owner party) on `starts_on`. It is repointed, not rebuilt.
- `equipment_rental_batches` + `equipment_project_allocations` are **DORMANT** — no UI,
  no server action; referenced only in `database.types.ts` and the orphan validators
  `src/lib/equipment/validate-rental-batch.ts` / `validate-allocation.ts`.
- The per-WP **usage layer is LIVE**: `check_out_equipment` / `check_in_equipment`,
  `equipment_usage_logs` (append-only + supersede, `daily_rate_snapshot`),
  `wp_equipment_sell`, the `wp_profit` fold, `wp-equipment-zone.tsx`,
  `src/lib/equipment/usage-actions.ts`.
- The **WHT engine exists and is unwired for rentals**: `wht_certificates`
  (`20260747000100`), `record_wht_certificate`, `post_wht_certificate_to_gl`; `wht_rates`
  seed has **rent = 5%**.
- `suppliers` has **no** `contact_status` (the `contact_status` enum is on
  `contractors` / `service_providers` only), no `tax_id`, no `is_vat_registered`.
- **No vendor-invoice / settlement object exists** anywhere. `equipment_usage_logs` is
  the internal charge-out; `equipment_rental_batches` is the internal cost commitment.

**Money posture (binding, unchanged — ADR 0055 decision 6 / spec 46).** Every ฿ field
— `daily_rate`, `daily_rate_snapshot`, batch/agreement rates, deposit, settlement
amounts, VAT/WHT — is zero-authenticated-grant, read only via the admin client for the
`pm / super / procurement` audience, **never** on a site_admin-reachable screen, and
audited. The check-out/check-in field surface stays **rate-free**. Rates are snapshotted
at entry and never rewritten.

---

## The two economic sides (design frame — read first)

The whole spec keeps these separate, exactly as Case A already does:

- **Inbound / vendor side** — what PRC **pays the rental vendor**: the agreement (payee
  supplier, rate + tiers, period, minimum days, deposit) → one-time fees → settlement
  (actual invoice: base + overtime + fees = net, + Input VAT, − WHT). The **deposit is a
  separate refundable asset** (paid up front, refunded or forfeited at return) — never a
  reduction of the rental cost. All new cost complexity lands here. Posts to GL.
- **Outbound / WP side** — what PRC **charges the profit-center WP**: **unchanged**. A
  flat per-item `daily_rate` × billable days via the shipped check-out/in +
  `wp_equipment_sell`. The field surface is untouched. PRC absorbs cost-shape in margin.

Rate tiers, minimum period, and overtime therefore describe the **vendor cost**, not the
WP transfer price.

---

## Roadmap (units, dependency-ordered)

| Unit   | Ships                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | DB?                | Depends on           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | -------------------- |
| **U0** | **Vendor unification.** `suppliers` gains `contact_status` + `tax_id` + `is_vat_registered`; migrate `equipment_owners` → `suppliers`; add + backfill `supplier_id` on `equipment_items` + `equipment_rental_batches` (deprecate `owner_id` additively); repoint `post_rental_batch_to_gl` credit **2120 → 2100**, party = supplier.                                                                                                                                           | **Yes** (additive) | ADR 0078             |
| **U1** | **Rental agreement (activate the dormant stack).** ALTER `equipment_rental_batches`: `deposit_amount`, `min_rental_days`, `status` enum (active/returned/settled/cancelled); new `rental_rate_tiers` child; `equipment_items.rental_agreement_id` (batch grain). RPCs `create_rental_agreement` / `update_rental_agreement` / `set_rental_rate_tiers` (mirror `create_subcontract`). Procurement UI on `/equipment` (new **สัญญาเช่า** section).                               | **Yes**            | U0                   |
| **U2** | **One-time fees.** New `rental_charges` (type delivery/pickup/cleaning/insurance/other, amount, vat_rate) mirroring `purchase_order_charges` (spec 260) + `add_rental_charge` / `void_rental_charge` RPCs + GL poster.                                                                                                                                                                                                                                                         | **Yes**            | U1                   |
| **U3** | **Settlement (VAT/WHT/deposit).** New append-only + supersede `rental_settlements` (vendor invoice: base + overtime + fees = net, VAT, WHT, method; deposit resolved separately as an asset) + `record_rental_settlement` / `supersede_rental_settlement` RPCs. GL poster: Dr WIP + Dr Input VAT (1300) / Cr AP (2100) or Bank, Cr WHT; deposit Dr 1320 at inception → released/forfeited at settlement; wire `record_wht_certificate` (rent 5%); seed account 1320 if absent. | **Yes**            | U1 (U2 for fees leg) |
| **U4** | **Variance roll-up.** Agreement detail (admin-read): Σ charged-to-WP (`wp_equipment_sell` over the agreement's items) vs Σ paid-to-vendor (settlements) + committed (agreement rate); overpay/under-recovery flag. Read-only, subcontract-roll-up pattern.                                                                                                                                                                                                                     | **No**             | U3                   |

WP check-out/check-in (the field value driver) is **already live** (spec 202 U2/U3) —
this spec adds no field surface. U0 is first and riskiest (a live-table migration); it
is **additive** (owner FKs deprecated, not dropped) to stay inside the self-merge
additive lane. The destructive `owner_id` drop / `equipment_owners` teardown is a
separate operator-held cleanup, **out of this spec**.

---

## U0 — Vendor unification (suppliers as the rental payee)

**Schema** (additive; change-management gate). Removes the intercompany special-case:
the rental payee becomes an ordinary `suppliers` vendor (ADR 0078 decisions 1–2).

### What ships

- **ALTER `suppliers`** — add `contact_status contact_status NOT NULL DEFAULT 'active'`
  (reuse the existing enum, blacklist parity with contractors/service_providers),
  `tax_id text NULL`, `is_vat_registered boolean NOT NULL DEFAULT false`. Column-scoped
  grants unchanged (back-office read/write via existing supplier policies); `tax_id`
  stays out of any site_admin surface.
- **Data migration** — for each `equipment_owners` row, upsert a `suppliers` row
  (name/phone carried; `tax_id`/VAT null) and record the owner→supplier id mapping in a
  transient mapping CTE.
- **ALTER `equipment_items`** + **`equipment_rental_batches`** — add
  `supplier_id uuid NULL REFERENCES suppliers(id)`; backfill from the owner→supplier
  mapping. Leave `owner_id` in place, **deprecated and unused** (documented; dropped in a
  later operator-held cleanup). No FK drop, no column drop.
- **Repoint `post_rental_batch_to_gl`** (`CREATE OR REPLACE`, re-sourced byte-for-byte
  from the LIVE definition) — credit **account 2100 (trade AP)** with party = the
  agreement's `supplier_id`, instead of 2120 (intercompany) / owner party. Debit 1400
  WIP unchanged. Verify 2100 exists in the seeded chart; the reverse-and-repost
  auto-correct path is preserved.

### Scope

- **IN:** the three `suppliers` columns; the owner→supplier data migration; `supplier_id`
  on items + batches with backfill; the poster repoint; pgTAP; spec/tracker.
- **OUT:** dropping `owner_id` or `equipment_owners` (operator-held destructive cleanup,
  separate); supplier bank-account fields (settlement `method` suffices v1; payout detail
  deferred); any supplier-facing portal (dropped entirely, ADR 0078 decision 3); touching
  the live usage/check-out layer.

### Money posture

`tax_id` and VAT flag join the back-office-only supplier read; no money field is newly
exposed. The poster runs service-role in the drain, as today.

### Tests

- **pgTAP** (RED first): `suppliers` has `contact_status`/`tax_id`/`is_vat_registered`
  with the right defaults; every pre-existing `equipment_owners` row has a matching
  `suppliers` row post-migration; `equipment_items`/`equipment_rental_batches` `supplier_id`
  backfilled and FK-valid; `owner_id` still present (deprecation, not drop);
  `post_rental_batch_to_gl` credits 2100 with the supplier party (insert a batch with a
  `supplier_id`, drain, assert the journal line account + party); reverse-and-repost still
  balances on edit.

### Verification

`pnpm lint && pnpm typecheck && pnpm test` green. pgTAP RED pre-apply → **operator OK to
push (schema gate)** → `db:push` → `db:test` green → `db:types`. Operator on-device: a
rental vendor appears in the supplier master with a blacklist status; existing equipment
still resolves its (now supplier-backed) vendor.

### Seams

- `owner_id` drop + `equipment_owners` teardown — a later operator-held destructive
  migration once this has soaked.
- Supplier payout bank detail — deferred; add when settlements pay out programmatically.

---

## U1 — Rental agreement (activate the dormant `equipment_rental_batches` stack)

**Schema** (additive; change-management gate). Gives the dormant batch/allocation stack
its first fields, RPCs, and UI. The agreement is the standalone rental object (ADR 0078
decision 6), modelled on `subcontracts` (agreed-vs-paid).

### What ships

- **ALTER `equipment_rental_batches`** (→ "rental agreement" conceptually): add
  `deposit_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (>= 0)` (money, no grant),
  `deposit_paid_date date NULL` (drives the deposit-asset GL leg in U3),
  `min_rental_days int NULL CHECK (> 0)`, `status rental_agreement_status NOT NULL
DEFAULT 'active'`. New enum `rental_agreement_status` = active | returned | settled |
  cancelled.
- **New `rental_rate_tiers`** — `(id, agreement_id FK, period_type rental_period_type
[daily|weekly|monthly], rate numeric(12,2) CHECK (>= 0), created_by, created_at)`; the
  vendor's price ladder (informational + drives the expected-cost figure in U4).
  Zero-grant money table.
- **ALTER `equipment_items`** — add `rental_agreement_id uuid NULL REFERENCES
equipment_rental_batches(id)` (null = owned / not-rented; batch-grain membership per
  sub-decision C). Field-visible tracking column (not money).
- **RPCs** (SECURITY DEFINER, gate `is_manager()` + procurement, mirroring
  `create_subcontract` / `update_subcontract`): `create_rental_agreement`
  (supplier_id, starts_on, ends_on?, monthly_rate, deposit_amount, min_rental_days?) →
  uuid; `update_rental_agreement` (COALESCE semantics, incl. status transitions);
  `set_rental_rate_tiers` (reconcile the child set). Each audits
  (`rental_agreement_create` / `_update` / `_tiers_set`, pinned in the enum + pgTAP 03
  and 18).
- **UI — `/equipment` gains a สัญญาเช่า section** (procurement/back-office only,
  `canManageRegistry`): list active agreements (admin-read money), create/edit an
  agreement (supplier picker, rate + tiers, period, deposit, min-days), assign
  registered items to the agreement. Mirrors the existing money-gated equipment surfaces;
  never rendered for site_admin.

### Scope

- **IN:** the three batch columns + enum; `rental_rate_tiers`; `equipment_items.rental_agreement_id`;
  the three RPCs + audit values; the สัญญาเช่า UI + server actions; pgTAP; spec/tracker.
- **OUT:** per-item deposit/return grain (batch grain v1, sub-decision C); fees (U2);
  settlement (U3); variance (U4); any change to the WP check-out surface; wet-rental /
  operator / fuel (v2).

### Money posture

Agreement rates, deposit, and tiers are zero-grant; the สัญญาเช่า section is admin-read
under `canManageRegistry` only. `rental_agreement_id` on the item is field-visible
tracking (no money).

### Tests

- **TDD (RED first):** pure validators for the create/update payloads (mirror
  `validate-rental-batch.ts`, which already exists) + the UI component tests (agreement
  create calls the action; the section renders only under `canManageRegistry`).
- **pgTAP:** the RPC gates (procurement/pm/super `lives_ok`, site_admin/visitor `42501`);
  zero-grant on the new money columns + `rental_rate_tiers`; audit rows; status-enum
  values; `set_rental_rate_tiers` reconcile.

### Verification

vitest green; pgTAP RED → operator push → `db:test` → `db:types`. Operator on-device: as
procurement, create a rental agreement against a supplier with a monthly rate + tiers +
deposit, assign an item to it; as site_admin confirm the สัญญาเช่า section and all money
are invisible.

### Seams

- Per-item deposit/return and item membership beyond batch grain — v2.
- The expected-cost figure from tiers is surfaced in U4, not here.

---

## U2 — One-time fees (delivery / pickup / cleaning / insurance)

**Schema** (additive; change-management gate). Mirrors PO-level charges (spec 260) on
the rental agreement.

### What ships

- **New `rental_charges`** — `(id, agreement_id FK, charge_type rental_charge_type
[delivery|pickup|cleaning|insurance|other], amount numeric(12,2) CHECK (> 0), vat_rate
numeric(5,2) NOT NULL DEFAULT 0, note text [required for 'other'], created_by,
created_at, superseded_by)`. Append-only + supersede (or void), zero-grant money table,
  RPC-only writer — the `purchase_order_charges` shape.
- **RPCs** `add_rental_charge` / `void_rental_charge` (gate pm/super/procurement; void
  gate manager-only — the spec 260 posture), audited.
- **GL** — AFTER-INSERT enqueue → drain route → poster: Dr expense/WIP (net) + Dr Input
  VAT (1300, split by `vat_rate`) / Cr AP (2100), party = the agreement's supplier. Void
  reverses (or skips a pending outbox job), the spec 259/260 pattern.

### Scope

- **IN:** `rental_charges` + enum; the two RPCs + audit values; the GL poster + drain
  route; pgTAP; spec/tracker.
- **OUT:** allocating a fee across WPs (agreement-grain cost v1; WP allocation deferred);
  operator/fuel (v2); fees not on an agreement.

### Money posture / Tests / Verification

Zero-grant money table, admin-read only. pgTAP: charge insert enqueues + posts the
net/VAT split to 2100 with the supplier party; void reverses; gates; append-only guard.
`pnpm test` + pgTAP RED → operator push → `db:test` → `db:types`.

### Seams

- Per-WP fee allocation (largest-remainder split like spec 260) — v2 if wanted.

---

## U3 — Settlement: vendor invoice with deposit, Input VAT, and WHT

**Schema** (additive; change-management gate). The load-bearing new object — no
vendor-invoice record exists today (ADR 0078 decision 7).

### What ships

- **New `rental_settlements`** (append-only + supersede) — `(id, agreement_id FK,
invoice_no text, invoice_date date, base_amount numeric(12,2), overtime_amount
numeric(12,2) DEFAULT 0, fees_amount numeric(12,2) DEFAULT 0, net_amount numeric(12,2),
vat_amount numeric(12,2) DEFAULT 0, wht_amount numeric(12,2) DEFAULT 0,
deposit_refunded numeric(12,2) DEFAULT 0, deposit_forfeited numeric(12,2) DEFAULT 0,
method receipt_method, note text, created_by, created_at, superseded_by,
correction_reason text NULL)`. Zero-grant money table; `overtime_amount` is the
  operator-entered overtime line (sub-decision D — not metered hourly). CHECK: amounts ≥
  0; `net_amount` reconciles to base + overtime + fees (the **rental cost only** — the
  deposit is NOT netted here); `deposit_refunded + deposit_forfeited ≤` the agreement's
  `deposit_amount`.
- **RPCs** `record_rental_settlement` / `supersede_rental_settlement` (gate
  pm/super/procurement, mirror `record_subcontract_payment` / `supersede_subcontract_payment`),
  audited.
- **Deposit lifecycle** — deposit is a **prepaid asset** with two GL events, both owned
  by U3's poster domain: **(1) paid** — when the agreement's `deposit_paid_date` is set,
  Dr account **1320 (deposit-prepaid)** / Cr Bank; **(2) resolved at settlement** — the
  refunded portion Dr Bank / Cr 1320, the forfeited portion Dr expense (or 1400) / Cr
  1320 (`deposit_refunded` + `deposit_forfeited` on the settlement). The deposit is never
  netted into the rental `net_amount`. **Seed account 1320 if absent** (verify the chart
  in this unit).
- **WHT** — the settlement calls the existing `record_wht_certificate` (rent = 5%, from
  the seed) → `post_wht_certificate_to_gl`. Rentals begin issuing WHT certificates here.
- **Input VAT** — the settlement splits net/VAT → Dr account **1300 (Input VAT)** when
  the agreement's supplier `is_vat_registered`. Requires U0's `suppliers.is_vat_registered`.
- **GL poster** `post_rental_settlement_to_gl` (subcontract-payment shape + redrain
  guard): Dr 1400 WIP / expense (net base + overtime + fees) + Dr 1300 Input VAT + Cr AP
  (2100) or Bank (1110), Cr WHT payable, with the deposit release leg. Reverse-and-repost
  on supersede.

### Scope

- **IN:** `rental_settlements` + RPCs + audit values; the GL poster + drain route; the
  deposit release leg + 1320 seed; the WHT wiring; the Input VAT split; pgTAP;
  spec/tracker.
- **OUT:** auto plan-vs-actual reconciliation (v2 — needs the uncoded spec 271
  classification library + WP-grain generalization); metered-hourly overtime (v2 — the
  overtime line is operator-entered); per-item settlement grain (v2).

### Money posture

Zero-grant; settlement is a back-office-only surface. `daily_rate_snapshot` untouched.

### Tests

- **pgTAP** (RED first): a settlement inserts + posts a balanced journal (WIP + Input VAT
  legs, AP/Bank credit, WHT credit, deposit release); WHT at 5% of the rent base; VAT
  split only when `is_vat_registered`; the deposit-paid leg debits 1320, and
  `deposit_refunded` / `deposit_forfeited` release 1320 at settlement (never netted into
  `net_amount`); supersede reverses-and-reposts and balances; append-only guard blocks UPDATE/DELETE;
  gates (procurement/pm/super `lives_ok`, others `42501`); account 1320 exists post-migration.
- **TDD:** the record/supersede action payload validators + error mapping.

### Verification

pgTAP RED → operator push → `db:test` → `db:types`; vitest green. Operator on-device: as
procurement, record a vendor invoice against an agreement (base + overtime + a delivery
fee), confirm the GL entry balances with an Input VAT leg + a 5% WHT certificate; refund
the deposit and see account 1320 clear.

### Seams

- Auto reconcile (spec 271 reuse), metered overtime, per-item grain — all v2.

---

## U4 — Variance roll-up (committed vs charged vs paid)

**No schema** — a pure admin-read surface on the agreement detail, mirroring the
`subcontracts` Σ agreed vs Σ paid roll-up.

### What ships

- **Pure helper** (`src/lib/equipment/rental-variance.ts`, TDD first): given an
  agreement's items and its settlements, compute **Σ charged-to-WP** (sum
  `wp_equipment_sell`-basis over usage logs for items where `rental_agreement_id =
agreement`), **Σ paid-to-vendor** (current settlements' `net_amount` via the supersede
  anti-join), and **committed** (agreement rate × period / tiers). Flag over-recovery
  (charged > paid → PRC margin) and under-recovery (charged < paid → PRC loss), the
  subcontract overpay-flag pattern.
- **UI** — the สัญญาเช่า agreement detail (admin-read under `canManageRegistry`) shows
  the three figures + the flag. Read-only.

### Scope

- **IN:** the pure helper + tests; the agreement-detail roll-up display. **OUT:** any
  write; auto-reconcile; charts; exporting.

### Money posture / Tests / Verification

Admin-read only; all three figures are money, gated to `canManageRegistry`. vitest for
the helper (charged/paid/committed math, supersede-aware, over/under flag). `pnpm test`
green; no DB. Operator on-device: an agreement with usage + a settlement shows charged
vs paid vs committed with the correct flag.

### Seams

- Auto plan-vs-actual classification (spec 271) — v2.

---

## Cross-cutting / open items

- **ADR 0078** must be accepted before U0 (it is the decision record for the
  vendor-unification + cost model).
- **Exact COA codes** (1300 Input VAT, 1320 deposit-prepaid, 2100 trade AP, WHT payable)
  are from the seam sweep and are re-verified against the seeded chart in U0/U3; 1320 is
  seeded in U3 if absent.
- **Schema is single-lane** — U0–U3 each touch `supabase/migrations/`; claim the lane in
  `../LANES.md` and build them serially, one session.
- **Deferred to v2** (ADR 0078 decision 8): wet-rental (operator + fuel), per-item
  deposit/return grain, metered-hourly overtime, the frozen `wp_equipment_costs` +
  WP-dimensioned GL (ADR 0055 decision 5's freeze), purchase-plan integration of rental
  demand, and auto plan-vs-actual reconciliation.
