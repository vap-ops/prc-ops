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

## U4 — repoint the portal onto the worker (U4a SHIPPED; U4b/U4c planned)

**U4a SHIPPED 2026-06-21** (operator confirmed binding mechanism **(A) worker
invite/claim**, "proceed"). The unit ADR 0062 §U4 names is materially bigger than
U1–U3 and is decomposed into **U4a / U4b / U4c**, one per session.

### Why it's big

The external portal (ADR 0051, specs 130/131/132) is **entirely contractor-party
bound**. A portal session is a `role='contractor'` user attached via
`contractor_users` (the invite/claim flow, mig 20260706); every surface resolves
through `current_user_contractor_id()`:

| Portal surface                                                     | Source today                                        | Keyed on                                       |
| ------------------------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------- |
| Profile (name, phone, tax_id, email, contact person, mailing addr) | `contractors`                                       | contractor_id (RLS self-read, mig 20260707)    |
| Emergency contact + DOB                                            | `contractors`                                       | own-contractor RPC (mig 20260710)              |
| Consents (PDPA / background check)                                 | `contractor_consents`                               | contractor_id (mig 20260709)                   |
| Bank (display + staged change → PM approval)                       | `contact_bank` + `contractor_bank_change_requests`  | contractor_id (mig 20260708)                   |
| Documents (id card / bank book / certs)                            | `contact_attachments` + storage `contractor/<id>/…` | contractor_id (mig 20260711)                   |
| Crew (each member's current project)                               | `get_my_crew_assignments()`                         | contractor_id (mig 20260759)                   |
| Payments                                                           | `get_my_dc_payments()`                              | **worker_id** (U3 bridge — already worker-ish) |

**Key framing:** this portal _is the DC portal_ — it was built to show a DC their
pay, packet, and deployment. Under ADR 0062 a DC is a worker, so U4 is "move the
portal's binding + reads from the DC-contractor-party to the DC-worker," and the
`contractor_users` DC binding becomes vestigial (retired in U6). **OPEN-1
(verify before U4a):** confirm no _subcontractor-party_ portal tenant exists
today (the surfaces above are all DC-shaped — packet/`dcTypeOfSubtype`, DC
payments). If the portal is DC-only, the re-home is a clean move; if a
subcontractor party is also meant to use it, the page becomes dual-tenant
(branch on whichever of `current_user_contractor_id()` / `current_user_worker_id()`
resolves) — a larger build.

### The binding-mechanism decision (OPEN-2 — the key call)

`workers.user_id` already exists (nullable, FK → users, **no unique constraint**,
and already in the authenticated SELECT grant). How does a DC's LINE login attach
to their worker row + become `role='contractor'`?

- **(A) Worker invite/claim — RECOMMENDED.** Mirror `contractor_invites`: a PM
  issues a worker-bound, single-use, expiring token from `/workers`; the DC logs
  in (visitor) and claims it → sets `workers.user_id = auth.uid()` +
  `role='contractor'`, audited. Same self-serve UX the contractor onboarding
  already uses; no PM hunting for a LINE account. Costs a `worker_invites` table
  (or generalising `contractor_invites` to be worker-bindable) + a
  `claim_worker_invite` RPC.
- **(B) PM links directly.** The DC logs in (visitor); the PM picks them in
  `/workers` and sets `workers.user_id` + flips role. Less infra, but the PM must
  match the right LINE account by hand, and a visitor→contractor role flip needs
  a sanctioned writer anyway.

Recommendation: **(A)**, for parity with the proven claim UX. U4a builds it.

### U4a — worker portal binding primitive (SHIPPED 2026-06-21)

**SHIPPED** on `main` (commit 0766b06), migrations 20260784 + fix-forward 20260785;
binding mechanism (A) worker invite/claim. The plan below shipped as written, with:
OPEN-3 resolved (get_my_crew_assignments left contractor-scoped, re-home in U4b);
20260785 fix-forward for two known lessons (gen_random_bytes unreachable from
search_path=public → gen_random_uuid token; the worker_invites policy was bare →
eval-once `(select …)` wrapped — same defects as 20260706000200). pgTAP 116 (plan 28) + 38 (worker.user_id binding) + 73 (labor_logs now 3 SELECT policies).
Verified lint · typecheck · vitest 1337 · db:test 116/2234/0 · build. The
contractor-based portal PAGE surfaces (profile/consents/bank/docs) still render
empty for a worker-bound DC until U4b/U4c re-home them; payments work worker-direct.

- **Migration:** partial-unique index on `workers.user_id` (`where user_id is not
null`) so one LINE user ↔ one worker; `current_user_worker_id()` SECURITY
  DEFINER helper (`select id from workers where user_id = auth.uid()`), the
  worker analogue of `current_user_contractor_id()`. The chosen binding mechanism
  (A: `worker_invites` + `create_worker_invite` (pm/super/director) +
  `claim_worker_invite` (visitor-only, one-binding, single-use/unexpired,
  audited role_change)).
- **RLS (ADR 0051 worker arm):** ADD permissive self-read arms so a DC worker
  reads **their own** rows — `workers` (own row via `user_id = auth.uid()`;
  day_rate/bank/tax stay column-grant-blocked), `labor_logs` (own DC days via
  `worker_id = current_user_worker_id()`). Wrap helper calls `(select …)` for the
  eval-once optimization (the file-40 lesson).
- **`get_my_dc_payments()`:** drop the U3 contractor bridge → read
  `worker_id = current_user_worker_id()` directly.
- **`get_my_crew_assignments()`:** a DC worker has no crew; either return just
  their own assignment (`worker_id = current_user_worker_id()`) or leave it
  contractor-scoped (NULL for a worker-bound DC) and let U4b re-home the section.
  Decide at build (OPEN-3).
- **pgTAP `38`:** add a worker-bound DC fixture; prove own-only isolation
  (worker, labor, payments) and that an internal/unbound session gets zero.
- **No app surface yet** — U4a is the binding + data layer; the page still renders
  the contractor surfaces (empty for a worker-bound DC until U4b/c). Safe: zero
  prod data.

### U4b — portal profile on the worker (SHIPPED 2026-06-21); consents → U4b-2

**Split for scope:** profile shipped now; **polymorphic consents** is the next
sub-unit (U4b-2). **U4b profile SHIPPED** on `main` (commit 6a70a9a, mig 20260786).
Operator decisions: **OPEN-4 = person-relevant fields only** (added `email`,
`emergency_contact_name/relation/phone`, `date_of_birth` to `workers`, zero-grant
PII; phone/tax_id already on the worker from U1; firm-shaped `contact_person` /
`mailing_address` / `specialty` NOT carried). **OPEN-5 = polymorphic consents**
(deferred to U4b-2 — add `worker_id` to `contractor_consents`, make `contractor_id`
nullable + XOR check, worker read-arm + worker record/revoke). What shipped:
`get_my_worker_profile()` (owner reads own PII past the zero-grant columns,
current_user_worker_id-scoped definer) + `update_own_worker_profile()` (self +
column-scoped — the six editable fields only; name/day_rate/tax_id out of reach);
`validateWorkerProfile`; `updateOwnWorkerProfile` action; `WorkerProfileEdit`
one-form component; `/portal` branches on a resolved worker binding → worker view
(name header + profile edit + tax_id read-only + payment history). pgTAP 117
(plan 15: self + column scope, unbound refused). Verified lint · typecheck ·
vitest 1344 · db:test 117/2251/0 · build.

**U4b-2 (polymorphic consents) SHIPPED 2026-06-21** (commit 61442f6, migs 20260787

- fix-forward 20260788). `contractor_consents` gained `worker_id` + nullable
  `contractor_id` + XOR check; bound-worker read-arm; `record_worker_consent`
  (self-scoped) + `revoke_contractor_consent` generalized to the bound worker;
  `recordOwnWorkerConsent` action + `WorkerConsents` component; the /portal worker
  branch renders consents. 20260788 re-added the `project_director` arm the
  fix dropped (pgTAP file 90). pgTAP 118 (plan 10). **U4c (bank + docs) still pending.**

**Original U4b plan (profile + consents):**

- Re-home the **profile** surface to `workers` (name + phone + tax*id +
  arrangement from U1). **OPEN-4:** the contractor-only fields the portal shows
  today — email, contact_person, mailing_address, emergency_contact*\*, DOB — are
  NOT on `workers`. Decide per field: add to `workers`, or drop for the DC portal.
  (Emergency contact + DOB are plausibly worth keeping → add columns; email /
  contact_person / mailing_address are firm-shaped → likely drop for an
  individual DC.)
- Re-home **consents** (PDPA / background check). **OPEN-5:** add a
  `worker_consents` table (mirror `contractor_consents`) vs. make consent
  polymorphic. Recommend a parallel `worker_consents` (smaller blast radius than
  a polymorphic refactor).
- Worker-scoped self-edit RPCs (the `update_own_*` analogues) + the portal page
  branches to the worker surfaces when `current_user_worker_id()` resolves.
- Tests: component + pgTAP for the worker self-edit + consent.

### U4c — portal bank + documents on the worker (U4c-1 bank display SHIPPED)

**U4c-1 (worker bank DISPLAY, read-only) SHIPPED 2026-06-21** (commit 0b12f7a, mig
20260789): `get_my_worker_profile` DROP+CREATE to also return the bank fields; the
/portal worker branch shows a read-only bank card. pgTAP 117 → plan 17.
**Remainder (heavier, each forked):** **U4c-2** = self-service staged bank-change →
PM approval (ADR 0051 §6 anti-fraud; OPEN-6: polymorphic `contractor_bank_change_
requests` + a worker submit RPC + a decide branch applying to `workers.bank_*` + a
PM approval surface on /workers). **U4c-3** = DC documents (OPEN-7: worker docs
table + `worker/<id>/…` storage prefix vs extend `contact_attachments` with
worker_id; storage RLS). Both need an operator decision before building.

- **Bank:** display from `workers` bank fields (U1) + a staged change → PM
  approval. **OPEN-6:** reuse `contractor_bank_change_requests` with a `worker_id`
  vs. a parallel `worker_bank_change_requests`. The U1 worker bank columns are
  zero-grant (money) → the owner reads them via a definer RPC (the `day_rate`
  posture).
- **Documents:** id card / bank book for a DC worker — **OPEN-7:** a worker docs
  table + storage prefix (`worker/<id>/…`) vs. extend `contact_attachments` with
  `worker_id`. The packet/completeness checklist (`contractorPacketStatus`) is
  reused against the worker's docs.
- Tests: storage RLS + pgTAP + component, mirroring specs 130 U4 / 131 U2c.

### Open decisions to confirm before building (summary)

- **OPEN-1** portal tenancy: DC-only (clean move) or dual-tenant (party + worker)?
- **OPEN-2** binding mechanism: (A) worker invite/claim [recommended] or (B) PM links directly?
- **OPEN-3** `get_my_crew_assignments` for a DC worker: own-assignment vs re-home in U4b.
- **OPEN-4** which contractor-only profile fields to carry onto `workers` vs drop.
- **OPEN-5/6/7** new worker-side tables (consents / bank-change / docs) vs extend the contractor ones with `worker_id`.

## U5–U6 — pending (see ADR 0062)

U5 remove /contacts/dc + its door + the `dc` ContactsTabs machinery; stop writing
`contractor_category='dc'` · U6 labels + cleanup; retire `contractor_users` for
DC if fully unused.

## Open questions

- Editing a DC worker's payee/arrangement after creation is not in the U1 add
  form (create-time only); a per-row edit is a small follow-up if the operator
  needs to correct bank details in place.
