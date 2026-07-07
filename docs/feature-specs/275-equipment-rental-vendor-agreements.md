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

| Unit   | Ships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | DB?                | Depends on           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | -------------------- |
| **U0** | **Vendor unification.** `suppliers` gains `contact_status` + `tax_id` + `is_vat_registered`; migrate `equipment_owners` → `suppliers`; add + backfill `supplier_id` on `equipment_items` + `equipment_rental_batches` (deprecate `owner_id` additively); repoint `post_rental_batch_to_gl` credit **2120 → 2100**, party = supplier.                                                                                                                                                                                                       | **Yes** (additive) | ADR 0078             |
| **U1** | **Rental agreement — finish vendor switch + agreement fields (extends merged spec 268).** ALTER `equipment_rental_batches`: `deposit_amount`/`deposit_paid_date`/`min_rental_days`/`status` enum + relax `owner_id` NULL. Repoint `create_equipment_rental_batch` `owner_id`→`supplier_id` (closes U0's null-party GL bug). `equipment_items.rental_agreement_id`. Extend 268's `RentalManager`/`createRentalBatch`/`rental-view` (owner→supplier + deposit/min-days/status). **Adopts 268's `rate_period`; `rental_rate_tiers` DROPPED.** | **Yes**            | U0 + #325            |
| **U2** | **One-time fees.** New `rental_charges` (type delivery/pickup/cleaning/insurance/other, amount, vat_rate) mirroring `purchase_order_charges` (spec 260) + `add_rental_charge` / `void_rental_charge` RPCs + GL poster.                                                                                                                                                                                                                                                                                                                     | **Yes**            | U1                   |
| **U3** | **Settlement (VAT/WHT/deposit).** New append-only + supersede `rental_settlements` (vendor invoice: base + overtime + fees = net, VAT, WHT, method; deposit resolved separately as an asset) + `record_rental_settlement` / `supersede_rental_settlement` RPCs. GL poster: Dr WIP + Dr Input VAT (1300) / Cr AP (2100) or Bank, Cr WHT; deposit Dr 1320 at inception → released/forfeited at settlement; wire `record_wht_certificate` (rent 5%); seed account 1320 if absent.                                                             | **Yes**            | U1 (U2 for fees leg) |
| **U4** | **Variance roll-up.** Agreement detail (admin-read): Σ charged-to-WP (`wp_equipment_sell` over the agreement's items) vs Σ paid-to-vendor (settlements) + committed (agreement rate); overpay/under-recovery flag. Read-only, subcontract-roll-up pattern.                                                                                                                                                                                                                                                                                 | **No**             | U3                   |
| **U5** | **Relocate rental recording to the project.** Surface the U1 recorder on the PROJECT detail page — a money-gated เช่าอุปกรณ์ entry (`BACK_OFFICE_ROLES`, never site_admin) → new `/projects/[id]/rentals` route rendering `RentalManager` **project-locked** (hides the โครงการ pick + the per-card re-allocate; auto-allocates every recorded rental to this project). Keeps the settings `/equipment/rentals` page as procurement's cross-project overview. Placement-only.                                                              | **No**             | U1                   |

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

## U1 — Rental agreement: finish the vendor switch + add agreement fields (extends merged spec 268)

**Schema** (additive; change-management gate). **Spec 268 (#325, merged `d3139e69`) already
activated the rental-batch stack** — the `/equipment/rentals` route, `RentalManager`,
`create_equipment_rental_batch` (6-arg, adds `p_rate_period` monthly|daily),
`create_equipment_project_allocation`, and allocate-on-create. U1 does **not** rebuild any of it.
U1 (a) finishes U0's vendor unification on the _create_ path — 268's create RPC + form still set
`owner_id`, but U0's GL poster reads `supplier_id`, so a 268-recorded batch posts rental GL with a
**null supplier party**; and (b) adds the agreement fields 268 lacks.

**Rate model:** adopt 268's `rate_period` (monthly|daily). The originally-planned
`rental_rate_tiers` ladder is **DROPPED** (operator, 2026-07-07 — two competing rate models on one
table; the ladder is YAGNI, revisit only for a real weekly-breakpoint deal).

### What ships

- **ALTER `equipment_rental_batches`**: add `deposit_amount numeric(12,2) NOT NULL DEFAULT 0
CHECK (>= 0)` (money, no grant), `deposit_paid_date date NULL` (drives the deposit-asset GL leg
  in U3), `min_rental_days int NULL CHECK (> 0)`, `status rental_agreement_status NOT NULL DEFAULT
'active'`. New enum `rental_agreement_status` = active | returned | settled | cancelled.
  **Relax `owner_id` to NULL-able** (new batches carry `supplier_id`; `owner_id` kept for existing
  rows, deprecated per U0).
- **Repoint `create_equipment_rental_batch` `owner_id` → `supplier_id`** (DROP/CREATE — the
  spec-268 arity precedent; body re-sourced VERBATIM from the LIVE 6-arg definition, then:
  `p_owner_id`→`p_supplier_id`, the owner-exists guard → `suppliers`, the INSERT sets `supplier_id`
  (not `owner_id`), audit payload key `owner_id`→`supplier_id`, and new trailing args
  `p_deposit_amount`/`p_deposit_paid_date`/`p_min_rental_days` (defaulted) flow into the INSERT).
  Re-establish grants **and `revoke ... from anon` EXPLICITLY** (the 072000 lesson — a DROP/CREATE
  reopens anon's default execute). Keeps the 5-role gate incl. `procurement_manager`.
- **ALTER `equipment_items`** — add `rental_agreement_id uuid NULL REFERENCES
equipment_rental_batches(id)` (null = owned / not-rented; batch-grain, sub-decision C).
  Field-visible tracking (not money).
- **UI — extend 268's `RentalManager` + `createRentalBatch`** (`/equipment/rentals` route + gate
  unchanged): the "เช่าจาก" select is fed by **`suppliers`** instead of `equipment_owners` (page
  swaps the RLS-client read; prop/state `owner*`→`supplier*`; the "ผู้ให้เช่า" label stays — a
  supplier IS the lessor); add optional **deposit** + **min-rental-days** inputs + a **status**
  control. `createRentalBatch` input `ownerId`→`supplierId` (+ deposit/minRentalDays), RPC arg
  `p_owner_id`→`p_supplier_id`. `rental-view.ts` `RentalBatchRow.ownerId/ownerName`→
  `supplierId/supplierName` (join `suppliers`).

### Scope

- **IN:** the four batch columns + `rental_agreement_status` enum; `owner_id` NULL relax; the
  `create_equipment_rental_batch` owner→supplier repoint (+ deposit/min-days args);
  `equipment_items.rental_agreement_id`; the `RentalManager`/`createRentalBatch`/`rental-view`
  supplier switch + deposit/min-days/status fields; extend pgTAP file 268 + vitest; spec/tracker.
- **OUT:** `rental_rate_tiers` (**dropped**); per-item deposit/return grain (batch grain v1);
  fees (U2); settlement (U3); variance (U4); the WP check-out surface; the allocation UI (268
  shipped it); wet-rental / operator / fuel (v2).

### Money posture

Deposit + rates stay zero-grant (the `equipment_rental_batches` posture); `/equipment/rentals` is
already `BACK_OFFICE_ROLES`-gated (268), never site_admin. `rental_agreement_id` on the item is
field-visible tracking. The `daily_rate` charge-out side is untouched (Case A).

### Tests

- **TDD (RED first):** extend `tests/unit/rental-manager.test.tsx` (supplier select fed from
  `suppliers`; deposit/min-days submit shape; status control) + `tests/unit/rental-view.test.ts`
  (`supplierName` join) + the `createRentalBatch` shape (`supplierId` + `p_supplier_id`).
- **pgTAP (extend file 268):** the four new columns + `rental_agreement_status` enum; `owner_id`
  now NULL-able; `equipment_items.rental_agreement_id`; `create_equipment_rental_batch` now takes
  `p_supplier_id` (owner arg gone), inserts `supplier_id`, gate preserved (procurement/pm/super/pd/
  procurement_manager `lives_ok`; site_admin/visitor `42501`; anon denied); and a created batch
  drains rental GL to **2100 with a non-null supplier party** (the U0 bug closed end-to-end).

### Verification

vitest green; pgTAP RED → operator push → `db:test` → `db:types`. Operator on-device: at
`/equipment/rentals`, record a rental from a **supplier** with a deposit + min-days; confirm it
saves and (once a project is bound) posts rental GL crediting 2100 with the supplier party; a
site_admin still cannot reach `/equipment/rentals`.

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

## U5 — Relocate rental recording to the project detail

**No schema** — a placement change that reuses U1's `RentalManager` /
`createRentalBatch` / `create_equipment_project_allocation` / `rental-view` unchanged.

**Why.** Spec 268 put the recorder in the SETTINGS hub (`/equipment/rentals`), but a
rental is project-driven — "we wouldn't make any rentals without a related WP" (operator,
2026-07-07). The three grains stay as ADR 0055 set them: **batch** (the vendor deal —
procurement-level, can span projects) → **allocation** (PROJECT-grain — a rented set
serves many WPs, not one) → **usage** (WP-grain check-out, already on WP detail). The gap
this closes: recording the batch+allocation lived in a global settings page instead of at
the project. This surfaces the recorder **at the project**, auto-allocating to it.

### What ships

- **`RentalManager` — optional project lock.** New optional prop `lockedProject?: {id,
name}`. When set: the record form **hides the โครงการ select** and forces
  `createRentalBatch` `projectId = lockedProject.id` (every recorded rental auto-allocates
  to this project on the same submit, via 268's allocate-on-create path); the per-card
  **ผูกโครงการ re-allocate control is hidden** (the project is fixed here — cross-project
  re-allocation stays on the settings overview). Unlocked (settings page) behaviour is
  **unchanged**.
- **New route `/projects/[id]/rentals`** (`page.tsx` + `loading.tsx`), mirroring
  `/projects/[id]/supply-plan`: `requireRole(BACK_OFFICE_ROLES)` (the money audience =
  the create-RPC gate; RLS scopes the project/supplier reads); reads the project +
  suppliers via the RLS client and **THIS project's rentals** via the admin client
  (`equipment_project_allocations` filtered to `project_id` → the referenced
  `equipment_rental_batches`, both zero-grant money tables); `DetailHeader`
  `backHref = projectHref(id)`; renders `RentalManager` with `lockedProject`. A `rentalsHref`
  is added to `src/lib/nav/project-paths.ts`.
- **Project-detail entry.** A money-gated เช่าอุปกรณ์ chip on `/projects/[id]` (mirrors the
  store / supply-plan header chips) shown only to `BACK_OFFICE_ROLES` — **never site_admin**
  (money surface, spec 46 / ADR 0055 decision 6).
- **Keep** the settings `/equipment/rentals` page as procurement's cross-project overview
  (unchanged — it renders `RentalManager` unlocked, with all projects + all rentals).

### Scope

- **IN:** the `RentalManager` `lockedProject` prop; the `/projects/[id]/rentals` route +
  loading; the `rentalsHref` helper; the project-detail entry chip; extend
  `tests/unit/rental-manager.test.tsx`; spec/tracker.
- **OUT:** any schema/RPC change; removing or demoting the settings `/equipment/rentals`
  page (kept as the cross-project overview); fees (U2); settlement (U3); variance (U4).

### Money posture

`BACK_OFFICE_ROLES`-gated, exactly like the settings page; batches/allocations read via
the admin client (zero-grant), supplier/project names via the RLS client; site_admin never
sees the entry or the route.

### Tests

- **TDD (RED first):** extend `tests/unit/rental-manager.test.tsx` — with `lockedProject`
  set, the โครงการ select is absent and a recorded rental calls `createRentalBatch` with
  `projectId = lockedProject.id`; the per-card ผูกโครงการ control is absent.

### Verification

`pnpm lint && pnpm typecheck && pnpm test` green (code-only — no DB). Operator on-device:
from a project as PM/procurement, open เช่าอุปกรณ์, record a rental with no project pick,
and confirm it lists under this project; a site_admin sees no เช่าอุปกรณ์ entry.

### Seams

- The settings `/equipment/rentals` page could later be narrowed to a pure read-only
  cross-project overview (drop its record form) — deferred; it stays fully functional now.

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
