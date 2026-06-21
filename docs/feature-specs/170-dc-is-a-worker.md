# Spec 170 — DC is a worker (ADR 0062 implementation arc)

**Decision:** [ADR 0062 — A DC is a worker, not a contractor party](../decisions/0062-dc-is-a-worker.md).
**Analysis:** [docs/design/dc-model-rethink.md](../design/dc-model-rethink.md).

This spec tracks the unit-by-unit implementation of ADR 0062: a DC (direct
contractor — paid directly, daily) becomes a single `workers` record, and the
`contractors` table is left for ผู้รับเหมาช่วง (subcontractors) only. Payment,
portal, and the Nova "external" flag repoint from the contractor party onto the
worker; `/contacts/dc` (spec 168's DC half) is folded into the worker roster.

Prod data audit (2026-06-21): `workers`=0, DC `contractors`=0, `dc_payments`=0,
`contractor_users`=0 → **no data-migration risk**; the arc is a clean reshape.
Each unit is a flagged schema change, TDD + pgTAP.

## U1 — a worker is a self-sufficient DC (SHIPPED 2026-06-21)

Additive — nothing removed; payment/portal/Nova keep working party-keyed until
U2–U4 repoint them.

- **Migration `20260778000000_dc_worker_fields.sql`:** new enum
  `public.dc_arrangement` (`regular` | `temporary`); `workers` gains
  `dc_arrangement` (DC-only via CHECK) + payee fields `phone`, `tax_id`,
  `bank_name`, `bank_account_number`, `bank_account_name` (length-capped). The
  **bank + tax + phone** columns get **no authenticated grant** (money/PII
  isolation, the `day_rate` posture, spec 46 C3) — readable only via the admin
  client behind `requireRole(pm/super)`; `dc_arrangement` IS granted
  (non-sensitive). `create_worker` / `update_worker` are DROP+CREATE'd (params
  can't be added via REPLACE) to accept the new fields, reproducing the
  spec-152 `project_director` gate, rejecting an arrangement on a non-dc worker,
  and the EXECUTE lockdown (spec 46 / 20260625000200) is re-applied for the new
  signatures.
- **No contractor parent for a directly-hired DC** — spec 160 already nulled
  `workers.contractor_id` + dropped the CHECK; the `/workers` add form drops the
  ผู้รับเหมา picker for DC and instead collects the arrangement (ประจำ/ชั่วคราว)
  - payee fields. `createWorker` keeps an optional `contractorId` for the
    subcontractor-crew flow (contact-crew-section) only.
- **Tests:** `worker-roster-manager.test.tsx` — DC form shows arrangement +
  payee, no contractor picker; adds a DC worker with arrangement + bank.
  pgTAP `29-labor-capture` (+7, now 60) — bank/tax isolated (42501),
  dc_arrangement readable, create makes a DC worker with no parent + stores
  arrangement/bank, arrangement rejected for non-dc. pgTAP `36` — the new
  signatures keep the authenticated-only EXECUTE lockdown.
- **Verification:** lint · typecheck · vitest · `db:test` 114 files / 2193 / 0 ·
  build green. db:push applied; db:types regenerated.

## U2–U6 — pending (see ADR 0062)

U2 Nova external → worker arrangement · U3 dc_payments → worker · U4 portal →
workers.user_id · U5 remove /contacts/dc + door · U6 labels + cleanup.

## Open questions

- Editing a DC worker's payee/arrangement after creation is not in the U1 add
  form (create-time only); a per-row edit is a small follow-up if the operator
  needs to correct bank details in place.
