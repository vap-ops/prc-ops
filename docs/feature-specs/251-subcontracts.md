# Spec 251 — Subcontracts: agreed value vs paid (ผู้รับเหมาช่วง)

**Status:** APPROVED (operator-aligned design 2026-07-03; part of the Finance build 249–253)
**Origin:** Finance user via operator — "ผู้รับเหมาสัญญาที่จ้างค่ะว่าเท่าไหร่ และจ่ายไปแล้วเท่าไหร่". Today `contractors` holds taxonomy/contact only; `workers.day_rate` + `dc_payments` cover DAILY workers (ADR 0062). There is **no entity for a lump-sum subcontract**. Operator decisions: lump sum **per WP, but one deal can span N work packages**, and **advance payments under an active WP happen** — model them.

## Goals

1. Record each subcontract deal: contractor, project, the WPs it covers, agreed amount.
2. Record payments against a deal — **advance / progress / final** — append-only.
3. Answer Finance: per deal and per contractor — agreed vs paid vs remaining.

## Data model (schema lane, migration ts `20260813064000`)

- **`subcontracts`**: `id`, `contractor_id NOT NULL → contractors`, `project_id NOT NULL → projects`, `title text NOT NULL`, `agreed_amount numeric(14,2) CHECK (> 0)`, `sign_date date NULL`, `status subcontract_status NOT NULL default 'active'` (new enum `active | completed | cancelled`), `note`, `document_path text NULL`, `created_by`, timestamps.
- **`subcontract_wps`**: `subcontract_id → subcontracts ON DELETE CASCADE`, `work_package_id → work_packages ON DELETE RESTRICT`, PK (both). Trigger: WP must belong to the subcontract's project. A WP MAY appear in several deals (no exclusivity — real life has split trades).
- **`subcontract_payments`** (append-only, supersede — mirrors `dc_payments`): `id`, `subcontract_id NOT NULL`, `kind subcontract_payment_kind NOT NULL` (new enum `advance | progress | final`), `amount numeric(14,2) CHECK (> 0)`, `paid_date date NOT NULL`, `method receipt_method NOT NULL` (**reuse the spec-249 enum** — same 3 values; if build order ever flips, whichever lands first creates it), `note`, `created_by`, `created_at`, `superseded_by NULL self-FK`. Append-only guard trigger.
- **RLS:** SELECT = money-read set (PM_ROLES + `accounting`); writes via DEFINER RPCs, PM_ROLES, null-safe fail-closed. No user UPDATE/DELETE anywhere.
- **RPCs:** `create_subcontract` / `update_subcontract` (header fields + status) / `set_subcontract_wps(p_subcontract, p_wp_ids uuid[])` (reconcile the join set) / `record_subcontract_payment` / `supersede_subcontract_payment`.
- **GL: none in v1** — matches the existing treatment of daily-labor money (`dc_payments` post no GL; labor enters economics via `wp_labor_costs`). Verify that premise at build time; if `dc_payments` DO post GL, STOP and surface before widening scope. Follow-up spec wires subcon cost into GL + `wp_profit` equipment-style.

## Behaviour / UI

- Project drill (spec 253) cost section: deals list — contractor · title · WPs chips · agreed · paid (Σ current payments) · remaining · payments drawer (advance rows badged "เงินล่วงหน้า") + record form (PM_ROLES).
- Contractor rollup: per contractor across deals (Σ agreed, Σ paid) — surfaced on the drill's subcon block; a dedicated `/accounting/subcontracts` register is OUT of v1 (add if Finance asks).
- Over-payment (paid > agreed) is allowed but rendered as a danger badge — real disputes exist; the app records, Finance chases.
- Pure helper `src/lib/accounting/subcontracts.ts`: current-payments rollup (anti-join), per-deal + per-contractor aggregates.

## Units

| Unit | Lane   | Content                                                                         |
| ---- | ------ | ------------------------------------------------------------------------------- |
| U1   | SCHEMA | 3 tables + 2 enums + triggers + RLS + 5 RPCs + pgTAP + db:types                 |
| U2   | code   | Deals + payments UI blocks (render on the spec 253 drill) + pure rollup helpers |

Out of scope: GL posting for subcon money (follow-up); retention on subcontracts; linking `subcontract_payments` to K BIZ disbursement (blocked epic); progress-% certification against a deal; contractor portal visibility of deals.

## Verification checklist

- [ ] pgTAP: append-only guards; RLS sets; RPC gates null-safe; WP-project trigger; set_subcontract_wps reconcile add+remove; RESTRICT on WP delete.
- [ ] Unit: rollups (advance+progress mix, superseded excluded, over-paid flag, per-contractor across 2 deals).
- [ ] `pnpm lint && pnpm typecheck && pnpm test` + full `pnpm db:test` green.
