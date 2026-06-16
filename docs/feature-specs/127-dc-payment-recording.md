# Spec 127 — DC payment recording (close the per-day payroll loop)

**Status:** in progress — 2026-06-16. **Type:** money + DB migration (prod) —
gated on explicit operator confirmation before `pnpm db:push` (Execution gate).

Realizes the seam [spec 69](69-dc-payroll-export.md) recorded:

> "A 'mark this period paid' / reconciliation state."

Operator decision (2026-06-16): target the **per-day (รายวัน) model** — close the
loop on the existing `labor_logs` → `/payroll` path. The lump-sum (เหมา / `dc_company`)
contract+installment model is a separate later track, not this spec.

## Why this is the unit

`/payroll` (spec 69) computes what you owe each DC contractor for a period and
exports a CSV — then **dead-ends**. Nothing in the app records that a contractor
was paid. Re-open the same period next week and it shows the identical numbers
whether or not the money moved: no paid state, no payment row, no audit of who
paid whom, no link to the contractor's bank. The cash loop never closes in-app.

This spec adds the **payment record** + reconciliation so payroll becomes a
ledger: per contractor × period, "จ่ายแล้ว ฿X เมื่อ DD/MM" vs "ค้างจ่าย".

## Payment model (operator-confirmed defaults)

- **Grain = contractor × exact period.** One payment row covers one contractor
  for one `(period_from, period_to)` window — the period the operator was
  viewing on `/payroll`. You pay the contractor for the month, not each worker;
  payroll already rolls up by contractor. Partial-period / overlapping-window
  reconciliation is a recorded seam (v1 matches the exact viewed period).
- **Snapshot + drift, like cost-freeze.** The record stores `computed_amount`
  (what payroll owed at record time, **server-recomputed** — the client never
  asserts a money figure) and `paid_amount` (what was actually transferred —
  may differ: partial, advance, deduction). If a later labor correction changes
  the live owed, the payroll surface shows an amber drift note (same UX as
  `wp_labor_costs` frozen-vs-live, spec 68). A correction never silently
  rewrites a payment.
- **Append-only (money posture).** `dc_payments` is append-only per the
  CLAUDE.md DC-entries mandate and the `labor_logs` precedent: no UPDATE/DELETE
  ever; a future void/correction is a superseding row (the void/correct RPC is
  U3, the columns ship now so the table's shape is final).
- **DC only.** Own crew are salaried (spec 69) — out of scope. The recompute
  filters `worker_type_snapshot = 'dc'`. The payroll "unassigned" group (null
  `contractor_id_snapshot`) cannot be paid (no contractor key) — resolve the
  worker's contractor first; recorded seam.

## Money posture (the security spine — unchanged from specs 46/68/69)

The whole `dc_payments` table is money and every reaching surface is already
PM-only (`/payroll`, `requireRole(PM_ROLES)`). So, exactly like
`wp_labor_costs`: **zero `authenticated` grant, RLS enabled, no policies.**
Reads go through the **service-role admin client** behind `requireRole(PM_ROLES)`;
writes go through the SECURITY DEFINER RPC invoked under the **caller's
authenticated session** (so `current_user_role()` and `auth.uid()` resolve —
the admin client has no JWT and would fail the gate, same invocation note as
`freeze_wp_labor_cost`). No money column or derived amount ever reaches a
`site_admin`-reachable surface or a client bundle.

## Units

### U1 — data layer + reconciliation helper (this unit)

DB migrations + pgTAP + types hand-extend + the pure `annotatePayrollPayments`
helper + unit tests. **No UI** (that is U2). Build everything green locally
against hand-extended types, then STOP and confirm with the operator before
`pnpm db:push` (Execution gate).

### U2 — payroll UI (next unit, not this session)

Per-contractor record-payment bottom-sheet (defaults: `paid_amount` =
computed, `paid_at` = today Bangkok, method select, reference, note; the
contractor's **bank shown** as the transfer target — closes the "money
scattered across 3 surfaces" gap), `recordDcPayment` server action
(`requireRole` pm/super, authenticated `supabase.rpc`), paid badge + drift note
per group, summary counts (จ่ายแล้ว X / ค้าง Y ราย).

### U3 — corrections + reconciliation depth (recorded seam)

Void/correct a payment via supersede; partial-period and overlapping-window
reconciliation; a "จ่ายแล้ว" column in the CSV export; audit each export.

## Data model (U1)

### Migration A — `dc_payment_recorded` audit_action (own migration)

`ALTER TYPE public.audit_action ADD VALUE 'dc_payment_recorded';` — own txn (the
value can't be referenced in the txn that adds it; same split as
`labor_cost_freeze`). **Enum-label pins to update (grep-all-enum-pins lesson):**
`supabase/tests/database/03-audit-log-shape.test.sql` and
`18-appsheet-writer-purchasing.test.sql` carry the full-label
`enum_has_labels` on `audit_action`. (Spec 68 listed `19-on-route-status` too,
but file 19 only references `audit_action` in a comment — no pin there;
verified this unit.)

### Migration B — `dc_payment_method` enum + `dc_payments` table + RPC

```
create type public.dc_payment_method as enum ('bank_transfer', 'cash', 'cheque');

create table public.dc_payments (
  id                uuid primary key default gen_random_uuid(),
  contractor_id     uuid          not null references public.contractors(id),
  period_from       date          not null,
  period_to         date          not null,
  computed_amount   numeric(12,2) not null,                       -- owed @ record time (server recompute)
  computed_days     numeric(6,1)  not null,
  paid_amount       numeric(12,2) null,                           -- actually paid; NULL only on a tombstone
  paid_at           date          not null,                       -- Bangkok payment date
  method            public.dc_payment_method not null,
  reference         text          null,
  note              text          null,
  paid_by           uuid          not null references public.users(id),
  superseded_by     uuid          null references public.dc_payments(id),
  correction_reason text          null,
  created_at        timestamptz   not null default now(),
  constraint dc_payments_period_order check (period_to >= period_from),
  constraint dc_payments_tombstone_shape check (paid_amount is not null or superseded_by is not null),
  constraint dc_payments_reason_iff_supersede check ((correction_reason is null) = (superseded_by is null)),
  constraint dc_payments_reference_len check (reference is null or length(reference) <= 120),
  constraint dc_payments_note_len      check (note      is null or length(note)      <= 500)
);

alter table public.dc_payments enable row level security;
revoke all on public.dc_payments from anon, authenticated;   -- money: zero grant, no policies
```

Append-only triple-layer (audit_log / labor_logs posture): zero grant already
blocks authenticated writes; add a `BEFORE UPDATE OR DELETE` trigger raising
`P0001` so even SECURITY DEFINER / service-role code cannot mutate or delete a
recorded payment (triggers fire regardless of RLS bypass). No UPDATE/DELETE
policy.

Indexes: `(contractor_id, period_from, period_to)` (dup probe + per-period
reconciliation read).

### `record_dc_payment(...) returns uuid` — SECURITY DEFINER

Args: `p_contractor uuid, p_from date, p_to date, p_paid_amount numeric,
p_paid_at date, p_method dc_payment_method, p_reference text, p_note text`.

- `set search_path = public`; role gate `current_user_role() in
('project_manager','super_admin')` else **42501** (site_admin refused — money,
  same as `freeze_wp_labor_cost` / `set_worker_day_rate`).
- Contractor existence probe → **P0001** if absent (SECURITY DEFINER bypasses
  RLS; v1 access is role-level per ADR 0013).
- `p_to >= p_from` and `p_paid_amount >= 0` → **P0001** otherwise (defense in
  depth; table CHECK also).
- `pg_advisory_xact_lock(hashtext(p_contractor::text || p_from::text || p_to::text))`.
- Duplicate guard: refuse **P0001** if a **current** (non-superseded)
  `dc_payments` row already exists for the exact `(contractor, from, to)`.
- **Recompute** `computed_amount` / `computed_days` from **current** `labor_logs`
  — the filter MUST match `aggregatePayroll` (spec 69): `day_fraction is not
null` AND not superseded AND `worker_type_snapshot = 'dc'` AND
  `contractor_id_snapshot = p_contractor` AND `work_date between p_from and
p_to`. `days = Σ (full→1.0, half→0.5)`; `amount = Σ fraction ×
day_rate_snapshot`.
- Insert the row (`paid_amount = p_paid_amount`, snapshots, `paid_by =
auth.uid()`, `reference`/`note` via `nullif(btrim(...), '')`).
- One `audit_log` row: `action='dc_payment_recorded'`, `target_table=
'dc_payments'`, `target_id = new id`, payload `{contractor_id, period_from,
period_to, computed_amount, computed_days, paid_amount, method}`.
- `revoke all on function … from public, anon; grant execute … to authenticated`.

## App layer (U1) — pure reconciliation helper

`src/lib/labor/payments.ts`:

- `DcPaymentRow = Pick<dc_payments.Row, id | contractor_id | period_from |
period_to | computed_amount | paid_amount | paid_at | method |
superseded_by>`.
- `annotatePayrollPayments(report: PayrollReport, payments: DcPaymentRow[],
range: PayrollRange): AnnotatedPayrollReport`
  - current payments only (supersede anti-join — drop any row referenced by
    another row's `superseded_by`);
  - per `report.contractors` group, match a current payment where
    `contractor_id === group.contractorId` AND `period_from === range.from` AND
    `period_to === range.to`;
  - matched → `payment: { paid: true, paidAmount, paidAt, method, computedAmount,
drifted }` where `drifted = round2(group.amount) !== round2(computedAmount)`
    (live owed moved since record — amber); unmatched → `payment: null`;
  - `AnnotatedPayrollReport = report & { contractors: AnnotatedGroup[], paidCount,
unpaidCount, paidAmountTotal, outstandingAmount }` — `outstandingAmount =
Σ group.amount over unpaid groups`; the unassigned (null id) group is always
    unpaid (cannot be keyed).
- `round2(n)` helper (2-dp money compare). Pure, no I/O.

`database.types.ts`: hand-extend — `dc_payments` Row/Insert/Update, the
`record_dc_payment` Functions entry, `dc_payment_method` enum, and
`'dc_payment_recorded'` in the `audit_action` union **and** the `Constants`
array. Reconcile byte-for-byte with `db:types` after the real push.

## Tests (TDD — failing first)

- **Unit (`tests/unit/labor-payments.test.ts`):** `annotatePayrollPayments` —
  unpaid group → `payment: null`; exact-period match → paid + amounts; period
  mismatch (off-by-one from/to) → unpaid; superseded payment ignored
  (anti-join); `drifted` true when live ≠ computed and false when equal (2-dp
  boundary); counts + `outstandingAmount` across mixed paid/unpaid; unassigned
  group never paid; empty payments → all unpaid.
- **pgTAP (`35-dc-payments.test.sql`):** `dc_payments` shape + CHECKs; **zero
  authenticated grant** (authenticated `select`/`insert`/`update`/`delete` →
  42501); append-only trigger (UPDATE/DELETE → P0001); `record_dc_payment` —
  pm happy path writes correct recomputed `computed_amount`/`days` from seeded
  DC logs + **one** `dc_payment_recorded` audit row with the right payload;
  **site_admin and visitor refused 42501**; contractor-not-found → P0001;
  duplicate exact period → P0001; recompute **excludes** superseded + tombstone
  - own-type logs + out-of-window dates; advisory-lock path (single insert).
    `_tap_buf` grant + `reset role` before `finish()` (file-10/26/34 pattern).
- **Update broken enum pins (same unit):** the `audit_action` `enum_has_labels`
  array in files **03 and 18** (add `dc_payment_recorded`; one assertion each,
  plan counts unaffected). File 19 has no `audit_action` pin.

## Verification (U1)

1. `pnpm lint && pnpm typecheck && pnpm test` green (hand-extended types).
2. `pnpm build` green (placeholder env).
3. **Gate → operator confirms →** `pnpm db:push` (prod) → `pnpm db:types` →
   reconcile vs the hand extension → `pnpm db:test` (linked DB) all green.
4. Acceptance (U2 lands the UI; U1 is data-layer): seed a DC labor period, call
   `record_dc_payment` via SQL as a pm, confirm the snapshot + audit row;
   confirm a site_admin call is refused; confirm authenticated cannot `select`
   `dc_payments`.

## Execution gate (prod safety)

Build everything locally — migrations + pgTAP + app — green against
hand-extended types, then **STOP and confirm with the operator before
`pnpm db:push`**. Code referencing the new schema must not deploy before the
migration is applied (the `main` push auto-deploys Vercel); migration first.

## Recorded seams (not this spec)

- U2 payroll UI (record sheet, badges, drift, bank-on-sheet, counts).
- U3 void/correct via supersede; partial/overlapping-period reconciliation;
  "paid" CSV column; audit each export.
- Paying the payroll "unassigned" group (resolve worker→contractor first).
- Lump-sum (เหมา / `dc_company`) contract + installment payments — separate track.
- Snapshot the contractor name on the payment row (today uses current name).
