# Spec 251 — Subcontracts: agreed value vs paid (ผู้รับเหมาช่วง)

**Status:** APPROVED (operator-aligned design 2026-07-03; part of the Finance build 249–253)
**Origin:** Finance user via operator — "ผู้รับเหมาสัญญาที่จ้างค่ะว่าเท่าไหร่ และจ่ายไปแล้วเท่าไหร่". Today `contractors` holds taxonomy/contact only; `workers.day_rate` + `dc_payments` cover DAILY workers (ADR 0062). There is **no entity for a lump-sum subcontract**. Operator decisions: lump sum **per WP, but one deal can span N work packages**, and **advance payments under an active WP happen** — model them.

## Goals

1. Record each subcontract deal: contractor, project, the WPs it covers, agreed amount.
2. Record payments against a deal — **advance / progress / final** — append-only.
3. Answer Finance: per deal and per contractor — agreed vs paid vs remaining.

## Data model (schema lane, migration ts `20260813067000`)

- **`subcontracts`**: `id`, `contractor_id NOT NULL → contractors`, `project_id NOT NULL → projects`, `title text NOT NULL`, `agreed_amount numeric(14,2) CHECK (> 0)`, `sign_date date NULL`, `status subcontract_status NOT NULL default 'active'` (new enum `active | completed | cancelled`), `note`, `document_path text NULL`, `created_by`, timestamps.
- **`subcontract_wps`**: `subcontract_id → subcontracts ON DELETE CASCADE`, `work_package_id → work_packages ON DELETE RESTRICT`, PK (both). Trigger: WP must belong to the subcontract's project. A WP MAY appear in several deals (no exclusivity — real life has split trades).
- **`subcontract_payments`** (append-only, supersede — mirrors `dc_payments`): `id`, `subcontract_id NOT NULL`, `kind subcontract_payment_kind NOT NULL` (new enum `advance | progress | final`), `amount numeric(14,2) CHECK (> 0)`, `paid_date date NOT NULL`, `method receipt_method NOT NULL` (**reuse the spec-249 enum** — same 3 values; if build order ever flips, whichever lands first creates it), `note`, `created_by`, `created_at`, `superseded_by NULL self-FK`. Append-only guard trigger.
- **RLS — CORRECTED to match house convention (verified against LIVE):** every money table in this build (`dc_payments`, `client_billings`, `retention_receivables`, `client_receipts`, `journal_entries`/`journal_lines`) is **zero authenticated grant**, RLS enabled with **no policies** — read only via the service-role admin client behind `requireRole([...PM_ROLES, 'accounting'])` (accounting widened per spec 252), written only by the DEFINER RPCs below (`is_manager()`, null-safe fail-closed — the 20260813051000 wrapper). `subcontracts`/`subcontract_wps`/`subcontract_payments` follow the same shape — no per-role SELECT policy to write. No user UPDATE/DELETE anywhere (`subcontract_payments` additionally append-only via block trigger).
- **RPCs:** `create_subcontract` / `update_subcontract` (header fields + status) / `set_subcontract_wps(p_subcontract, p_wp_ids uuid[])` (reconcile the join set) / `record_subcontract_payment` / `supersede_subcontract_payment`.
- **GL — RESOLVED (operator decision, 2026-07-03 night, correcting the premise below):**
  the checked-at-build-time premise ("`dc_payments` post no GL") turned out **FALSE**
  — `post_dc_payment_to_gl` posts a real 2-step accrual+settlement (Dr WIP 1400 /
  Cr AP-DC-clearing 2110 on labor-freeze; Dr 2110 / Cr Bank 1110 on payment).
  Subcontracts have **no equivalent accrual trigger** (no daily log, and per this
  spec's own out-of-scope list, no progress-% certification) — so a full 2-step
  mirror isn't buildable without inventing one. **Decision: post DIRECT, one step,
  at payment time — Dr WIP-construction (1400, `project_id` = the deal's project,
  `contractor_id` = the deal's contractor; `work_package_id` left NULL —
  `journal_lines.work_package_id` is nullable and a deal can span N WPs with no
  clean per-payment split) / Cr Bank (1110).** No clearing account. New poster
  `post_subcontract_payment_to_gl` (mirrors `post_dc_payment_to_gl`'s
  supersede/re-drain-guard shape — see
  `20260813065000_dc_payment_poster_redrain_guard.sql` for the exact reversal +
  re-drain logic to replicate; the `contractor_id` line dimension mirrors the DC
  poster's own `'contractor_id', v_contractor` attribution in
  `20260743000100_subledger_posters.sql`). **Known gaps, accepted:** (a) a
  subcontract payment not yet made shows no payable in the ledger (unlike DC,
  which accrues on work-logged) — closing that needs an accrual trigger, which
  needs progress-% certification; explicit follow-up, not this spec. (b) cost
  isn't attributed to a specific WP for a multi-WP deal (`wp_profit()` per-WP P&L
  won't see subcon cost split across its WPs) — same follow-up closes this too.

## Behaviour / UI

- Project drill (spec 253) cost section: deals list — contractor · title · WPs chips · agreed · paid (Σ current payments) · remaining · payments drawer (advance rows badged "เงินล่วงหน้า") + record form (PM_ROLES).
- Contractor rollup: per contractor across deals (Σ agreed, Σ paid) — surfaced on the drill's subcon block; a dedicated `/accounting/subcontracts` register is OUT of v1 (add if Finance asks).
- Over-payment (paid > agreed) is allowed but rendered as a danger badge — real disputes exist; the app records, Finance chases.
- Pure helper `src/lib/accounting/subcontracts.ts`: current-payments rollup (anti-join), per-deal + per-contractor aggregates.

## Units

| Unit | Lane   | Content                                                                                                                                                              |
| ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1   | SCHEMA | 3 tables + 2 enums + triggers + RLS + 5 RPCs + `post_subcontract_payment_to_gl` poster (drain-triggered, direct Dr 1400/Cr 1110, no accrual step) + pgTAP + db:types |
| U2   | code   | Deals + payments UI blocks (render on the spec 253 drill) + pure rollup helpers                                                                                      |

Out of scope: accrual-stage GL posting for subcon money (needs progress-% certification — follow-up); per-WP cost attribution for multi-WP deals (same follow-up); retention on subcontracts; linking `subcontract_payments` to K BIZ disbursement (blocked epic); progress-% certification against a deal; contractor portal visibility of deals.

## Verification checklist

- [ ] pgTAP: append-only guards; RLS sets; RPC gates null-safe; WP-project trigger; set_subcontract_wps reconcile add+remove; RESTRICT on WP delete.
- [ ] pgTAP: GL poster — balanced entry (Dr 1400 = Cr 1110), `project_id`+`contractor_id` set on the WIP line, `work_package_id` NULL; supersede reverses the old entry + posts the new; re-drain (payment reprocessed with no state change) posts nothing extra (mirrors pgTAP 256's attack shape); void (superseded, no live payment) posts nothing.
- [ ] Unit: rollups (advance+progress mix, superseded excluded, over-paid flag, per-contractor across 2 deals).
- [ ] `pnpm lint && pnpm typecheck && pnpm test` + full `pnpm db:test` green.
