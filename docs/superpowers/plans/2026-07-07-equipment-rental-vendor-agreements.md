# Equipment Rental (vendor-unified) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This repo builds ONE unit per session** (CLAUDE.md "Feature workflow" step 7: _Stop. Do not start the next unit in the same session_). Each Task below (U0–U4) is a **separate session and a separate PR**. Do **not** parallelize: U0–U3 touch `supabase/migrations/` and the schema is **single-lane** (only one session may push/`db:test` against the one shared remote DB). Execute strictly in order.

**Goal:** Generalize equipment rental away from the PRI intercompany special-case — unify the vendor onto `suppliers`, activate the dormant rental-agreement stack, and add the full cost model (deposit, Input VAT, WHT, one-time fees, rate tiers, minimum period, overtime) with a manual vendor-invoice settlement and a variance roll-up.

**Architecture:** Two economic sides kept separate (Case A, unchanged): the **vendor/inbound side** (agreement → fees → settlement → GL, all new complexity) and the **WP/outbound side** (flat `daily_rate` transfer price via the already-live check-out/in + `wp_equipment_sell` — untouched). Rental is a **standalone agreement** (the activated `equipment_rental_batches` stack, subcontract-shaped), never a PO line.

**Tech Stack:** Next.js 16 App Router (Server Components default), Supabase Postgres (RLS on every table, SECURITY DEFINER RPCs, pgTAP), TypeScript strict, Vitest, `pnpm`.

**Source of truth:** [Spec 275](../../feature-specs/275-equipment-rental-vendor-agreements.md) (field-level detail per unit) and [ADR 0078](../../decisions/0078-equipment-rental-vendor-unification.md) (decisions; amends ADR 0055). **Read the spec unit in full before building it** — this plan is the orchestration/sequencing/gate layer, not a replacement for the spec's field lists.

## Global Constraints

Every task's steps implicitly include all of these (verbatim from CLAUDE.md / the spec / the memory doctrine):

- **TDD-first, non-negotiable.** The first change in every unit is the **failing test**. State literally: **"Writing failing test first."** Implementation before a test is rejected in review.
- **RLS on every table. No exceptions.** New money tables are **zero authenticated grant** (REVOKE ALL from anon/authenticated, RLS enabled, **no** authenticated policies); read only via the admin client behind `requireRole(pm/super/procurement)`; **never** on a site_admin-reachable screen; audited. Rates are snapshotted at entry, never rewritten.
- **Append-only + supersede** for `rental_charges` and `rental_settlements` (new row with `superseded_by` FK; BEFORE UPDATE/DELETE/TRUNCATE trigger raising `P0001`; current state via anti-join `NOT EXISTS (newer.superseded_by = this.id)`). Never UPDATE/DELETE a row. (`.claude/skills/supersede-pattern`.)
- **Status/type fields are Postgres enums**, never free-text.
- **Re-source discipline (binding).** Any `CREATE OR REPLACE` of an existing definer (e.g. `post_rental_batch_to_gl`) is re-sourced **byte-for-byte from the LIVE definition**, then the delta is added — never re-derived from a migration file that may be stale. Confirm no later redefinition exists first.
- **Schema single-lane.** Before any `supabase/migrations/` work: read `../LANES.md`, **append a lane claim**, re-read it. Only one schema session at a time. Migration timestamps continue after the current max applied (`074000+` per memory; verify with the migrations dir).
- **Change-management gate.** `db:push` runs **only after explicit operator OK**. pgTAP is written RED first and must fail for the right reason pre-apply. `pnpm db:push` (never `-- --dry-run`; for a true dry run call `supabase db push --dry-run` directly). After push: `db:test` green → `db:types`.
- **Danger-path guard / autonomous-build fence.** Every unit is a PR via `scripts/ship-pr.sh`. U0–U3 touch migrations + money/GL → the guard **HOLDS them for operator merge** (do not attempt self-merge). U4 is code-only → auto-merges on green CI. Never `--no-verify`, never auto-authenticate `gh`.
- **Exact COA codes verified at build.** 1300 (Input VAT), 1320 (deposit-prepaid), 2100 (trade AP), and the WHT-payable account are from the seam sweep; re-verify against the seeded chart in the unit that touches each, and seed 1320 in U3 if absent.
- **Conventional Commits** (`feat:`/`fix:`/`test:`/`docs:`). Commit frequently. Update `docs/progress-tracker.md` at unit start (in-progress + start time) and end (complete + decisions/open questions).
- **Scope discipline.** Implement exactly the unit's spec. No "while I'm here" additions; surface out-of-scope finds in the tracker's open questions.

---

## Task U0 — Vendor unification (suppliers as the rental payee)

**Session/PR:** own session; **schema, additive; operator-held** (migrations + GL). **Spec:** §U0.

**Files:**

- Create: `supabase/migrations/<ts>_spec275u0_vendor_unification.sql`
- Create: `supabase/migrations/<ts>_spec275u0_repoint_rental_poster.sql` (separate file — a `CREATE OR REPLACE` of a live definer)
- Create: `supabase/tests/database/<n>-spec275u0-vendor-unification.test.sql`
- Modify (after `db:types`): `src/lib/db/database.types.ts` (regenerated, not hand-edited)

**Interfaces:**

- Produces: `suppliers.contact_status` / `suppliers.tax_id` / `suppliers.is_vat_registered`; `equipment_items.supplier_id`; `equipment_rental_batches.supplier_id` (all consumed by U1–U4). `post_rental_batch_to_gl` now credits **2100** with party = the batch's `supplier_id`.

- [ ] **Step 1 — Claim the schema lane.** Append to `../LANES.md` (Edit tool only — never PowerShell pipe): a line naming this session, branch `spec275-u0`, "SCHEMA LANE — spec 275 U0". Re-read the file to confirm no other active schema lane.

- [ ] **Step 2 — Read context.** Read spec §U0 in full; ADR 0078 decisions 1–2; `docs/policies/change-management.md`; the live `equipment_owners`, `suppliers`, `equipment_items`, `equipment_rental_batches` definitions; and the **live** body of `post_rental_batch_to_gl` (via `supabase` MCP or the latest migration, confirming it is the latest). Note the exact account/party columns the poster writes.

- [ ] **Step 3 — Writing failing test first.** Create the pgTAP file. Assertions (RED against the un-migrated DB):

```sql
-- suppliers gained the vendor columns with correct defaults
select has_column('public','suppliers','contact_status', 'suppliers.contact_status exists');
select col_default_is('public','suppliers','is_vat_registered','false','defaults false');
select has_column('public','suppliers','tax_id', 'suppliers.tax_id exists');
-- every equipment_owner has a mirrored supplier, and supplier_id is backfilled + FK-valid
select is_empty($$ select 1 from equipment_owners eo
  where not exists (select 1 from suppliers s where s.id = eo.id) $$,
  'every equipment_owner mirrored into suppliers');
select is_empty($$ select 1 from equipment_items where owner_id is not null and supplier_id is null $$,
  'equipment_items.supplier_id backfilled where owner_id set');
-- owner_id is deprecated (still present), not dropped
select has_column('public','equipment_items','owner_id','owner_id retained (deprecation, not drop)');
-- poster credits 2100 with the supplier party
-- (insert a batch with supplier_id, drain, assert journal_lines account_code = '2100' and party = supplier_id)
```

- [ ] **Step 4 — Run pgTAP; confirm RED for the right reason.** Run: `pnpm db:test` (targeting the new file). Expected: FAIL — columns/backfill absent (well-formed, not a syntax error).

- [ ] **Step 5 — Write the additive migration** (`_spec275u0_vendor_unification.sql`):

```sql
-- 1. suppliers gains vendor parity (reuse the existing contact_status enum)
alter table public.suppliers
  add column if not exists contact_status public.contact_status not null default 'active',
  add column if not exists tax_id text,
  add column if not exists is_vat_registered boolean not null default false;

-- 2. mirror equipment_owners into suppliers PRESERVING id (makes backfill an identity copy)
insert into public.suppliers (id, name, phone, created_by, created_at)
  select eo.id, eo.name, eo.phone, eo.created_by, eo.created_at
  from public.equipment_owners eo
  on conflict (id) do nothing;

-- 3. add + backfill supplier_id on the two rental-bearing tables (owner_id kept, deprecated)
alter table public.equipment_items
  add column if not exists supplier_id uuid references public.suppliers(id);
alter table public.equipment_rental_batches
  add column if not exists supplier_id uuid references public.suppliers(id);
update public.equipment_items         set supplier_id = owner_id where supplier_id is null and owner_id is not null;
update public.equipment_rental_batches set supplier_id = owner_id where supplier_id is null and owner_id is not null;
comment on column public.equipment_items.owner_id is 'DEPRECATED (spec 275 U0): use supplier_id. Dropped in a later operator-held cleanup.';
comment on column public.equipment_rental_batches.owner_id is 'DEPRECATED (spec 275 U0): use supplier_id.';
```

Verify grant posture: `supplier_id`/`tax_id` join the back-office-only supplier read; no new grant exposes money. (Any name collision skipped by `on conflict do nothing` must be reconciled by name — with a single PRI owner this is a no-op; note it in the tracker.)

- [ ] **Step 6 — Repoint the poster** (`_spec275u0_repoint_rental_poster.sql`): `CREATE OR REPLACE FUNCTION public.post_rental_batch_to_gl(...)` — paste the **live** body verbatim, then change only the credit leg: account `2120 → 2100`, party `owner_id → supplier_id` (read `supplier_id` on the batch row). Preserve the reverse-and-repost / redrain guard exactly. Verify account `2100` exists in the seeded chart.

- [ ] **Step 7 — Update the app error/read surface if needed.** (U0 is DB-only; no app read changes required. Skip unless `db:types` surfaces a break.)

- [ ] **Step 8 — Operator gate + push.** Surface to the operator: "spec 275 U0 additive migration ready — vendor unification + poster repoint. OK to `db:push`?" On OK: `pnpm db:push` → `pnpm db:test` (new file GREEN + full suite; watch the known pgTAP trio 100/200/221 and the GL-drain suspects — re-run once on a libuv `0xC0000409`) → `pnpm db:types`.

- [ ] **Step 9 — Verify + ship.** Run `pnpm lint && pnpm typecheck && pnpm test` (green). Commit (`feat(equipment): unify rental vendor onto suppliers + repoint rental GL to trade AP (spec 275 U0)`). Update `docs/progress-tracker.md`. Ship via `scripts/ship-pr.sh`; the PR **holds for operator merge** (danger-path: migrations + GL). Clear the `../LANES.md` claim after merge.

---

## Task U1 — Rental agreement (activate the dormant stack)

**Session/PR:** own session; **schema; operator-held**. **Depends on:** U0 merged. **Spec:** §U1.

**Files:**

- Create: `supabase/migrations/<ts>_spec275u1_rental_agreement.sql`
- Create: `supabase/tests/database/<n>-spec275u1-rental-agreement.test.sql`
- Create: `src/lib/equipment/validate-rental-agreement.ts` (pure; extends the existing `validate-rental-batch.ts` shape)
- Create: `src/components/features/equipment/rental-agreement-manager.tsx` (`'use client'` — justify in PR)
- Modify: `src/app/equipment/actions.ts` (add `createRentalAgreement` / `updateRentalAgreement` / `setRentalRateTiers`)
- Modify: `src/app/equipment/page.tsx` (admin-read agreements under `canManageRegistry`; render the สัญญาเช่า section)
- Modify: `src/lib/i18n/labels.ts` (SSOT — new labels)
- Create: `tests/unit/rental-agreement-manager.test.tsx`, `tests/unit/validate-rental-agreement.test.ts`

**Interfaces:**

- Consumes: `equipment_rental_batches.supplier_id` (U0).
- Produces: enum `rental_agreement_status` (active|returned|settled|cancelled); columns `equipment_rental_batches.{deposit_amount, deposit_paid_date, min_rental_days, status}`; table `rental_rate_tiers(id, agreement_id, period_type rental_period_type, rate, created_by, created_at)`; column `equipment_items.rental_agreement_id`; RPCs `create_rental_agreement(...) → uuid`, `update_rental_agreement(...)`, `set_rental_rate_tiers(...)`; audit values `rental_agreement_create|_update|_tiers_set`.

- [ ] **Step 1 — Claim the schema lane** (`../LANES.md`, branch `spec275-u1`). Re-read.

- [ ] **Step 2 — Read context.** Spec §U1; the **live** `create_subcontract` / `update_subcontract` bodies (the mirror); `is_manager()`; the existing `validate-rental-batch.ts`; the audit_action enum pins (grep BOTH `03-audit-log-shape.test.sql` AND `18-appsheet-writer-purchasing.test.sql`).

- [ ] **Step 3 — Writing failing test first (vitest, pure validator).** `tests/unit/validate-rental-agreement.test.ts`:

```ts
import { validateRentalAgreement } from "@/lib/equipment/validate-rental-agreement";
it("rejects a non-positive monthly rate", () => {
  expect(
    validateRentalAgreement({ supplierId: UUID, monthlyRate: 0, startsOn: "2026-07-07" }).ok,
  ).toBe(false);
});
it("rejects a min_rental_days <= 0", () => {
  expect(
    validateRentalAgreement({
      supplierId: UUID,
      monthlyRate: 100,
      startsOn: "2026-07-07",
      minRentalDays: 0,
    }).ok,
  ).toBe(false);
});
it("accepts a valid agreement", () => {
  expect(
    validateRentalAgreement({
      supplierId: UUID,
      monthlyRate: 50000,
      startsOn: "2026-07-07",
      depositAmount: 10000,
    }).ok,
  ).toBe(true);
});
```

- [ ] **Step 4 — Run vitest; confirm RED.** Run: `pnpm test tests/unit/validate-rental-agreement.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 5 — Implement the pure validator** `src/lib/equipment/validate-rental-agreement.ts` (finite/≥0 money guards, UUID supplierId, ISO-date, `minRentalDays > 0` when present). Re-run Step 4 → PASS. Commit.

- [ ] **Step 6 — Writing failing test first (pgTAP).** `<n>-spec275u1-rental-agreement.test.sql`: enum `rental_agreement_status` values exist; the four new batch columns + `rental_rate_tiers` + `equipment_items.rental_agreement_id` exist; `rental_rate_tiers` and the money columns are **zero-grant**; RPC gates (`create_rental_agreement` as procurement/pm/super → `lives_ok`; as site_admin/visitor → `42501`); `set_rental_rate_tiers` reconciles the child set; audit rows written. RED first (`pnpm db:test`).

- [ ] **Step 7 — Write the migration** (`_spec275u1_rental_agreement.sql`):

```sql
create type public.rental_agreement_status as enum ('active','returned','settled','cancelled');
create type public.rental_period_type   as enum ('daily','weekly','monthly');

alter table public.equipment_rental_batches
  add column deposit_amount   numeric(12,2) not null default 0 check (deposit_amount >= 0),
  add column deposit_paid_date date,
  add column min_rental_days   int check (min_rental_days > 0),
  add column status public.rental_agreement_status not null default 'active';

create table public.rental_rate_tiers (
  id           uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.equipment_rental_batches(id) on delete cascade,
  period_type  public.rental_period_type not null,
  rate         numeric(12,2) not null check (rate >= 0),
  created_by   uuid not null references public.users(id),
  created_at   timestamptz not null default now(),
  unique (agreement_id, period_type)
);
alter table public.equipment_items add column rental_agreement_id uuid references public.equipment_rental_batches(id);

-- zero-grant money posture
revoke all on public.rental_rate_tiers from anon, authenticated;
alter table public.rental_rate_tiers enable row level security;  -- no authenticated policies
-- + new audit_action enum values; + the three SECURITY DEFINER RPCs mirroring create/update_subcontract
--   (gate: is_manager() OR procurement — per spec money-write audience), each audited.
```

Write the three RPCs by mirroring the live `create_subcontract`/`update_subcontract` (COALESCE-on-update semantics; audit each). Add the audit enum values in their **own** statement and pin them in both `03` and `18` pgTAP files.

- [ ] **Step 8 — Run pgTAP RED pre-apply**, then **operator gate → `db:push` → `db:test` (green) → `db:types`**.

- [ ] **Step 9 — Writing failing test first (component).** `tests/unit/rental-agreement-manager.test.tsx`: the create form calls `createRentalAgreement` with the payload; the สัญญาเช่า section renders **only** under `canManageRegistry` (money-posture guard — never for site_admin). RED first.

- [ ] **Step 10 — Implement the actions + component + labels + page wiring.** `createRentalAgreement`/`updateRentalAgreement`/`setRentalRateTiers` in `actions.ts` (mirror `setEquipmentDailyRate`: `requireRole(BACK_OFFICE_ROLES)` defense-in-depth, relay to the definer, map `42501`/`P0001` → Thai, `revalidatePath('/equipment')`). `RentalAgreementManager` mirrors the money-gated equipment surfaces. Page reads agreements via the **admin client only when `canManageRegistry`**. New labels in `labels.ts`. Re-run Step 9 → PASS.

- [ ] **Step 11 — Verify + ship.** `pnpm lint && pnpm typecheck && pnpm test` green. Commit (`feat(equipment): rental agreements — activate the dormant batch stack (spec 275 U1)`). Tracker. `scripts/ship-pr.sh` → **operator-held** (migration). Clear the lane after merge.

---

## Task U2 — One-time fees

**Session/PR:** own session; **schema; operator-held**. **Depends on:** U1 merged. **Spec:** §U2.

**Files:**

- Create: `supabase/migrations/<ts>_spec275u2_rental_charges.sql`
- Create: `supabase/migrations/<ts>_spec275u2_route_rental_charges_gl.sql` (drain CASE + poster)
- Create: `supabase/tests/database/<n>-spec275u2-rental-charges.test.sql`
- Modify: `src/app/equipment/actions.ts` (`addRentalCharge` / `voidRentalCharge`), `rental-agreement-manager.tsx` (charge sub-form), `labels.ts`
- Create: `tests/unit/rental-charges.test.tsx`

**Interfaces:**

- Consumes: the agreement id (U1).
- Produces: table `rental_charges(id, agreement_id, charge_type rental_charge_type, amount, vat_rate, note, created_by, created_at, superseded_by)`; enum `rental_charge_type` (delivery|pickup|cleaning|insurance|other); RPCs `add_rental_charge(...)`, `void_rental_charge(...)`; a `drain_gl_posting` route + `post_rental_charge_to_gl`.

- [ ] **Step 1 — Claim lane** (`spec275-u2`). Read spec §U2; the **live** `purchase_order_charges` table + `add_purchase_order_charge`/`void_purchase_order_charge` + the spec-260 poster + `drain_gl_posting` CASE (the mirror).

- [ ] **Step 2 — Writing failing test first (pgTAP).** `rental_charges` exists + zero-grant + append-only trigger; `add_rental_charge` gate pm/super/procurement (`42501` otherwise); a charge insert **enqueues + posts** the net/VAT split to **Dr expense/WIP + Dr 1300 / Cr 2100** (party = the agreement's supplier); `void_rental_charge` (manager-only) reverses the posted entry or skips a pending outbox job; append-only guard blocks UPDATE/DELETE. RED (`pnpm db:test`).

- [ ] **Step 3 — Write the migration(s):** `rental_charges` (mirror `purchase_order_charges`: `amount > 0` GROSS incl VAT, `vat_rate` default 0, `note` required for `'other'`, append-only + `superseded_by`, zero-grant, RPC-only writer); the two RPCs; the enqueue trigger; the `drain_gl_posting` CASE branch routing `rental_charges → post_rental_charge_to_gl`; the poster (net/VAT split, party = supplier). Add audit enum values (pin in `03` + `18`). **Note (ADR 0045):** `amount` is GROSS — the poster derives net = amount/(1+vat_rate/100); do not double-book VAT.

- [ ] **Step 4 — pgTAP RED → operator gate → `db:push` → `db:test` → `db:types`.**

- [ ] **Step 5 — Writing failing test first (component)** for the charge sub-form (`addRentalCharge` called; void guarded). Then implement `addRentalCharge`/`voidRentalCharge` actions + the sub-form + labels. Test → PASS.

- [ ] **Step 6 — Verify + ship.** `pnpm lint && pnpm typecheck && pnpm test`. Commit (`feat(equipment): one-time rental fees (spec 275 U2)`). Tracker. Ship → **operator-held**. Clear lane.

---

## Task U3 — Settlement (deposit, Input VAT, WHT)

**Session/PR:** own session; **schema; operator-held**. **Depends on:** U1 (and U2 for the fees leg). **Spec:** §U3.

**Files:**

- Create: `supabase/migrations/<ts>_spec275u3_rental_settlements.sql`
- Create: `supabase/migrations/<ts>_spec275u3_route_rental_settlement_gl.sql`
- Create: `supabase/migrations/<ts>_spec275u3_seed_deposit_account.sql` (only if 1320 absent)
- Create: `supabase/tests/database/<n>-spec275u3-rental-settlement.test.sql`
- Modify: `src/app/equipment/actions.ts` (`recordRentalSettlement` / `supersedeRentalSettlement`), `rental-agreement-manager.tsx` (settlement form), `labels.ts`
- Create: `tests/unit/rental-settlement.test.tsx`

**Interfaces:**

- Consumes: agreement id + `deposit_amount`/`deposit_paid_date` (U1); the supplier's `is_vat_registered` (U0); the live `record_wht_certificate` / `post_wht_certificate_to_gl` (rent = 5%).
- Produces: table `rental_settlements(id, agreement_id, invoice_no, invoice_date, base_amount, overtime_amount, fees_amount, net_amount, vat_amount, wht_amount, deposit_refunded, deposit_forfeited, method receipt_method, note, created_by, created_at, superseded_by, correction_reason)`; RPCs `record_rental_settlement(...)`, `supersede_rental_settlement(...)`; `post_rental_settlement_to_gl` (+ deposit legs); `drain_gl_posting` route.

- [ ] **Step 1 — Claim lane** (`spec275-u3`). Read spec §U3; the **live** `record_subcontract_payment`/`supersede_subcontract_payment` + `post_subcontract_payment_to_gl` (the redrain-guard mirror); `record_wht_certificate` + `post_wht_certificate_to_gl` + the `wht_rates` seed (confirm rent = 5%); the seeded chart of accounts (confirm 1300 Input VAT, 2100 AP, WHT-payable; **check whether 1320 exists**).

- [ ] **Step 2 — Writing failing test first (pgTAP).** Assertions:

```
-- table + posture
rental_settlements exists; zero-grant; append-only trigger blocks UPDATE/DELETE.
-- deposit is NOT netted into net_amount
net_amount == base_amount + overtime_amount + fees_amount   (CHECK holds).
deposit_refunded + deposit_forfeited <= agreement.deposit_amount.
-- GL: a settlement posts a BALANCED journal
Dr 1400/expense (net) + Dr 1300 (input VAT, only when supplier.is_vat_registered)
  / Cr 2100 (or 1110) + Cr WHT-payable ; sum(debits) == sum(credits).
-- WHT at 5% of the rent base
a wht_certificate is issued at 5% of base_amount.
-- deposit lifecycle
deposit-paid leg debits 1320 (fired off deposit_paid_date);
deposit_refunded credits 1320 (Dr bank); deposit_forfeited credits 1320 (Dr expense).
-- account 1320 exists post-migration; gates (procurement/pm/super lives_ok, else 42501);
-- supersede reverses-and-reposts and re-balances.
```

RED (`pnpm db:test`).

- [ ] **Step 3 — Seed account 1320 if absent** (`_seed_deposit_account.sql`): insert a `1320` "Deposit — prepaid (rental)" asset account into the chart, matching the existing seed pattern. (Skip the file if it already exists — confirm in Step 1.)

- [ ] **Step 4 — Write the settlement migration:** `rental_settlements` (fields above; append-only + supersede; zero-grant; CHECK `net_amount = base+overtime+fees` and the deposit ceiling); `record_rental_settlement`/`supersede_rental_settlement` (mirror the subcontract-payment RPCs; gate pm/super/procurement; on record, if `is_vat_registered` split VAT, and call `record_wht_certificate` at the rent rate); audit enum values (pin `03`+`18`).

- [ ] **Step 5 — Write the GL poster + route:** `post_rental_settlement_to_gl` (subcontract-payment shape + redrain guard): Dr 1400/expense (net) + Dr 1300 (VAT) / Cr 2100 or 1110, Cr WHT-payable; deposit legs — paid (Dr 1320 / Cr Bank, fired from `deposit_paid_date`), refunded (Dr Bank / Cr 1320), forfeited (Dr expense / Cr 1320). Add the `drain_gl_posting` CASE route. Reverse-and-repost on supersede.

- [ ] **Step 6 — pgTAP RED → operator gate → `db:push` → `db:test` → `db:types`.**

- [ ] **Step 7 — Writing failing test first (component)** for the settlement form (`recordRentalSettlement` called with base/overtime/fees/deposit fields; supersede path). Implement the actions + form + labels. Test → PASS.

- [ ] **Step 8 — Verify + ship.** `pnpm lint && pnpm typecheck && pnpm test`. Commit (`feat(equipment): rental settlement — deposit/VAT/WHT (spec 275 U3)`). Tracker. Ship → **operator-held**. Clear lane.

---

## Task U4 — Variance roll-up

**Session/PR:** own session; **code-only → auto-merges on green CI**. **Depends on:** U3 merged. **Spec:** §U4.

**Files:**

- Create: `src/lib/equipment/rental-variance.ts` (pure)
- Create: `tests/unit/rental-variance.test.ts`
- Modify: `src/components/features/equipment/rental-agreement-manager.tsx` (agreement-detail roll-up display), `src/app/equipment/page.tsx` (admin-read the settlements + usage totals for the agreement), `labels.ts`

**Interfaces:**

- Consumes: usage logs for items where `rental_agreement_id = agreement` (via `wp_equipment_sell` basis); current `rental_settlements.net_amount` (supersede anti-join); the agreement rate/tiers.
- Produces: `computeRentalVariance({ chargedToWp, paidToVendor, committed }) → { chargedToWp, paidToVendor, committed, flag: 'over_recovery' | 'under_recovery' | 'even' }`.

- [ ] **Step 1 — Writing failing test first.** `tests/unit/rental-variance.test.ts`:

```ts
import { computeRentalVariance } from "@/lib/equipment/rental-variance";
it("flags over-recovery when charged exceeds paid (PRC margin)", () => {
  expect(computeRentalVariance({ chargedToWp: 120, paidToVendor: 100, committed: 100 }).flag).toBe(
    "over_recovery",
  );
});
it("flags under-recovery when paid exceeds charged (PRC loss)", () => {
  expect(computeRentalVariance({ chargedToWp: 80, paidToVendor: 100, committed: 100 }).flag).toBe(
    "under_recovery",
  );
});
it("is even when charged equals paid", () => {
  expect(computeRentalVariance({ chargedToWp: 100, paidToVendor: 100, committed: 100 }).flag).toBe(
    "even",
  );
});
```

- [ ] **Step 2 — Run test; confirm RED.** Run: `pnpm test tests/unit/rental-variance.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3 — Implement the pure helper** `src/lib/equipment/rental-variance.ts` (compare charged vs paid; `over_recovery` when charged > paid, `under_recovery` when charged < paid, else `even`; return the three figures). Re-run Step 2 → PASS. Commit (`feat(equipment): rental variance helper (spec 275 U4)`).

- [ ] **Step 4 — Wire the roll-up into the agreement detail.** Page reads (admin-client, `canManageRegistry` only) the agreement's settlements (current, anti-join) + the usage-log charged total for its items + the committed figure; passes them through `computeRentalVariance`; the detail shows the three figures + flag, **read-only**, money-gated. New labels.

- [ ] **Step 5 — Verify + ship.** `pnpm lint && pnpm typecheck && pnpm test` green. Commit. Tracker (spec 275 arc complete; note deferred v2 items). `scripts/ship-pr.sh` → **auto-merges on green** (code-only, no danger path).

---

## Self-Review (against spec 275)

**1. Spec coverage.** U0 ↔ §U0 (vendor unify + poster repoint); U1 ↔ §U1 (agreement + tiers + item link + UI); U2 ↔ §U2 (fees); U3 ↔ §U3 (settlement + deposit/VAT/WHT + 1320 seed); U4 ↔ §U4 (variance). The spec's money posture, TDD-first, single-lane, and operator-gate constraints are lifted into Global Constraints and repeated per unit. No spec section is unmapped.

**2. Placeholders.** The `<ts>`/`<n>` tokens are migration-timestamp / pgTAP-file-number placeholders resolved at build (the repo assigns them from the current max) — not content gaps. SQL bodies that must be re-sourced from LIVE (`post_rental_batch_to_gl`, the subcontract/charge/wht mirrors) are explicit **read-then-mirror** steps, per the binding re-source discipline — deliberately not invented here, because inventing them would risk drift from the live definitions.

**3. Type consistency.** `supplier_id` (U0) is consumed by U1–U4; `rental_agreement_status` / `rental_period_type` / `rental_charge_type` are defined once (U1/U2) and reused; `rental_settlements.net_amount = base+overtime+fees` (deposit excluded) is consistent across §frame, roadmap, U3 fields, U3 tests, and the variance roll-up (which compares `net_amount` paid vs `wp_equipment_sell` charged). `computeRentalVariance` signature (U4) matches its test.

---

## Execution notes (repo-specific override of the generic handoff)

Because the schema is **single-lane** and this repo builds **one unit per session** with an **operator `db:push` gate** and **danger-path holds**, the generic "dispatch a fresh subagent per task in parallel" model does **not** apply. Execute **serially, one unit per session**, in the order U0 → U1 → U2 → U3 → U4, each as its own PR, each waiting on the prior unit's merge (U0–U3 hold for operator merge; U4 auto-merges). Within a unit, a subagent may carry the TDD cycle, but the schema push and PR remain operator-gated.
