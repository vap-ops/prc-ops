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

## U2 — Nova "external" comes from the worker (SHIPPED 2026-06-21)

The external/internal split drove off the worker's contractor being a
`dc_temporary` **party** (`contractor_subtype='dc_temporary'`). Now that a DC is a
worker, "external" = the **worker's** `dc_arrangement = 'temporary'` (ชั่วคราว).

- **Migration `20260779000000_dc_external_from_worker.sql`:** CREATE OR REPLACE
  the two functions that read the rule — `distribute_project_coins` (the coin
  weight: external → flat `external_factor`, internal → level weight) and
  `coin_unvested_balance` (the external lock: an external's whole balance stays
  unvested). Both now read `worker.dc_arrangement = 'temporary'` instead of
  joining to `contractors.contractor_subtype`. Signatures unchanged → grants
  preserved; no app/type change (function bodies only).
- **Tests:** pgTAP `106-coin-distribution` + `108-nova-vesting` — the external DC
  fixture is now marked by `update workers set dc_arrangement='temporary'`
  (keyed on the holdover dc_temporary contractor); the external-weight and
  external-lock assertions are unchanged and pass through the new path.
- **Verification:** `db:test` full suite green; app untouched.

## U3 — DC payment keys on the worker (SHIPPED 2026-06-21)

The whole payroll surface was built around **contractor → worker grouping**; the
payee is now the worker. Shipped on `main` (commit 1a315b9), migrations 20260782

- 20260783; verified lint · typecheck · vitest 1335 · db:test 115/2205/0 · build.

**What shipped (vs the plan below):**

- **Migration `20260782000000_dc_payment_keys_on_worker.sql`:** `dc_payments`
  `contractor_id → worker_id` (drop FK, rename, add FK → workers, swap the
  `_period_idx` to `worker_period_idx`); `record_dc_payment(p_worker, …)` DROP+
  CREATE, sums CURRENT DC `labor_logs` by `worker_id`, one payment per (worker,
  period), worker-existence guard, audit payload `worker_id`, EXECUTE re-granted;
  `get_my_dc_payments()` CREATE OR REPLACE bridge — `worker_id in (select id from
workers where contractor_id = current_user_contractor_id())` (real portal
  repoint is U4).
- **Migration `20260783000000_repoint_dc_payment_gl_poster.sql` (UNPLANNED
  collateral):** `post_dc_payment_to_gl` (spec 149 U4c) read the renamed column
  and posted it as the journal line's **contractor party** → it would error at
  drain time. A DC is a worker, and `journal_lines` has **no worker dimension**,
  so the DC-clearing line now carries **no party** (Dr 2110 / Cr 1110, unkeyed).
  A worker party dimension on the GL is a possible later spec. (The spec's "the
  append-only trigger is DDL-safe" note missed the GL enqueue trigger + poster.)
- **lib:** `aggregatePayroll` → flat `WorkerPay[]` (dropped `ContractorGroup` +
  the contractor-name map arg + `contractor_id_snapshot` from `PayrollInputRow`);
  `PayrollReport = { workers, totalDays, totalAmount, workerCount }`; per-worker
  CSV (`ช่าง,จำนวนวัน,ค่าแรง (บาท)`). `annotatePayrollPayments` keyed by
  `worker_id` (`AnnotatedWorker`, no unassigned sentinel). `fetchWorkerBanks`
  reads the worker's own `bank_name/bank_account_number/bank_account_name` (U1).
  `fetch-payroll` dropped the contractor lookup. `validateDcPayment` → `workerId`.
- **UI:** `/payroll` per-worker cards (record affordance per worker; empty notice
  → "ไม่มีบันทึกค่าแรง DC ในช่วงนี้"); `record-payment-sheet` + `recordDcPayment`
  bind `workerId/workerName`; `/payroll/export` route unchanged (delegates).
  Portal (`load-portal-data` + `/portal`) needed **no change** — it never read
  `contractor_id` off a payment.
- **pgTAP:** `35-dc-payments` rewritten worker-keyed (plan 24: + worker_id/​FK
  pins, worker-existence guard); `38-contractor-portal-rls` bridge (worker_id
  assertions); `82`/`84` GL fixtures repointed to a worker, `84` asserts the DC
  line has **no party** (`contractor_id is null`).

**Lesson:** a column rename's blast radius includes every SECURITY DEFINER that
reads it — grep migrations for live readers, not just the spec's listed files
(`record_dc_payment`, `get_my_dc_payments`, **and** `post_dc_payment_to_gl` here).

---

Original investigation (2026-06-21) — exact touchpoints found:

- **DB — `dc_payments` table** (`20260704000100`): `contractor_id` → `worker_id`
  (FK → workers); swap the `dc_payments_contractor_period_idx`. Empty data → a
  clean ALTER. Append-only trigger is DDL-safe.
- **DB — `record_dc_payment`** (latest body in `20260751`, line 1227): DROP+CREATE
  `record_dc_payment(p_worker, …)` — sum CURRENT DC `labor_logs` by **`worker_id`**
  (was `contractor_id_snapshot`), one payment per (worker, period); re-apply the
  EXECUTE grant for the new signature (it's revoked from public/anon + granted to
  authenticated in `20260704000100`).
- **DB — `get_my_dc_payments`** (`20260707`, line 43): reads
  `dc_payments.contractor_id` → must change. **Transitional bridge** (real portal
  repoint is U4): `where d.worker_id in (select id from workers where contractor_id
= current_user_contractor_id())`.
- **lib `payroll.ts`** — `aggregatePayroll` returns a **flat `WorkerPay[]`** (drop
  `ContractorGroup`); `PayrollReport = { workers, totalDays, totalAmount,
workerCount }`; `payrollToCsv` columns ช่าง/วัน/ค่าแรง. Note: `PayrollInputRow`
  is pinned to the schema Row, so the `contractor_id` rename surfaces every
  consumer as a type error — follow the errors.
- **lib `payments.ts`** — `annotatePayrollPayments` keys payment annotation by
  **worker_id**; `DC_PAYMENT_METHOD_LABELS` unchanged.
- **lib `fetch-payments.ts`** — `fetchPeriodPayments` keys by worker_id;
  `fetchContractorBanks` → **`fetchWorkerBanks`** reading the **worker's own** bank
  fields (added in U1: `bank_name`/`bank_account_number`/`bank_account_name`).
- **lib `fetch-payroll.ts`** — drop the contractor-name map arg to aggregatePayroll.
- **page `/payroll`** — per-**worker** cards (was per-contractor) with the
  record-payment affordance per worker; no "unassigned contractor" sentinel.
- **`record-payment-sheet.tsx`** + **`labor/actions.ts` `recordDcPayment`** — bind a
  **worker** (workerId/workerName + the worker's bank); pass `p_worker`.
- **`/payroll/export/route.ts`** — per-worker CSV.
- **portal `load-portal-data.ts` + `/portal`** — `get_my_dc_payments` rows now carry
  `worker_id`; verify the payment display doesn't read `contractor_id`.
- **pgTAP `35-dc-payments`** — rewrite the fixtures + assertions to worker-keyed
  (record by worker, one-per-(worker,period), compute by worker_id). **pgTAP
  `38-contractor-portal-rls`** — update the `get_my_dc_payments` test to the bridge.

## U4–U6 — pending (see ADR 0062)

U4 portal → workers.user_id (real portal binding; finish get_my_dc_payments +
the RLS policies) · U5 remove /contacts/dc + door + the `dc` ContactsTabs
machinery · U6 labels + cleanup.

## Open questions

- Editing a DC worker's payee/arrangement after creation is not in the U1 add
  form (create-time only); a per-row edit is a small follow-up if the operator
  needs to correct bank details in place.
