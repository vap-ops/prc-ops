# ADR 0073 — Worker identity merge: one ช่าง (own + dc → `pay_type` × `employment_type`)

## Status

Accepted — 2026-07-05. **Supersedes ADR 0062** (a DC is a worker, not a
contractor party). ADR 0062's spine is **kept**: a directly-hired field person is
a single `workers` record — there is no DC contractor party, payment keys on
`worker_id`, portal binds `workers.user_id`, Nova "external" derives from the
worker. This ADR **reverses ADR 0062's remaining modelling layer**: the `own` vs
`dc` `worker_type` split, the `dc_arrangement` (regular/temporary) column, and the
term **"DC"** itself. It realizes the **"DC → technician role merge"** that ADR
0071 and ADR 0072 both explicitly deferred to "a separate future ADR at the role
layer" (0072 §"Out of scope") — and, per the operator's locked decision, promotes
it from a role-layer relabel to a **clean schema rebuild** (greenfield).

Extends / touches ADR 0072 (staff self-onboarding — the approve RPC's field-role
side-effect writes a worker; that write repoints here), ADR 0071 (technician
role), ADR 0070 (role = enum value, not a flag), ADR 0060 / 0061 (Nova economics
/ worker-ecosystem — the "external" tier), ADR 0051 (external-partner portal — the
`contractor` role now means **subcontractor only**), ADR 0057 (GL — the wage
poster renames), ADR 0050 (super_admin role management), ADR 0008 (role-enum —
`technician` / `contractor` values already exist, no enum growth). Spec 266.

## Context

The operator's goal is blunt: **remove the term "DC" from the app entirely**, and
stop modelling a company employee and a directly-hired daily worker as two
different *kinds* of worker. They are one kind of person — **a ช่าง** — who differ
only along two **orthogonal** axes:

- **how they are paid** — a monthly salary (paid off-app) or a daily wage
  (`day_rate` × days, paid in-app);
- **their employment tenure** — a permanent member of the team, or a temporary
  hire (the Nova "external" tier; convertible to permanent later).

Today (ADR 0062) those two axes are jammed into two coupled columns:

- `workers.worker_type` — `own` (company staff, monthly) vs `dc` (direct
  contractor, daily). This is really a **pay** distinction wearing an
  **identity-class** costume, and it forces the term "DC" through the whole app.
- `workers.dc_arrangement` — `regular` vs `temporary`, **only meaningful when
  `worker_type='dc'`** (a CHECK/nullable coupling). This is really the **tenure**
  axis, but it is welded to the DC identity-class and cannot describe a permanent
  vs temporary *salaried* worker.

The coupling means "an own worker who is temporary" or "a daily worker who is
permanent" (an internal DC — long-term team, paid daily) are awkward or
inexpressible, and every payroll / roster / Nova / label surface has to special-
case "DC". The operator wants the two axes **independent**, and the word "DC"
gone: the daily-paid team are just ช่าง paid รายวัน.

**Live-data finding (re-verified 2026-07-05, prod, before this ADR):** the tables
this reshapes are effectively empty — `workers` = **1** (a single throwaway test
row), `dc_payments` = **0**, `labor_logs` = **0**, `contractors` = **2** (both
real subcontractors, unaffected), `technician_registrations`/`staff_registrations`
= **1** (a test row), and there are **no** users with role `technician` or
`contractor`. As under ADR 0062, this is a **greenfield reshape with no
backfill**: the one test worker and one test registration are **wiped** as part of
the rebuild, and the model is rebuilt cleanly — the right moment, before real
ช่าง data exists. (Counts re-confirmed at U1 build time immediately before the
destructive migration; enum columns cast `::text` in any `coalesce`.)

A second, long-standing conflation the operator wants fixed at the same time:
**company technicians and subcontractors must live in separate settings menus.**
"DC" has historically bled into the `contractors`/ผู้รับเหมา surfaces (labels like
"ผู้รับเหมา (DC)"). Subcontractors (ผู้รับเหมาช่วง — the `contractors` table, a
firm that pays its own crew) are **functionally untouched** here; they are only
**moved to their own menu** and **de-conflated** from the DC vocabulary.

## Decision

### 1 — One worker identity: ช่าง

The `workers` row is the single canonical record for a directly-employed field
person — **a ช่าง** (individual). The group / menu term is **ทีมช่าง**. There is
no more `own` vs `dc`, and the word "DC" does not appear in the schema, the UI, or
the labels. (ADR 0062's "one record, no contractor party" holds — this only
removes the sub-typing on top of it.)

### 2 — Two orthogonal fields replace `worker_type` + `dc_arrangement`

Each ช่าง carries two **independent** fields:

| Field | Thai (การจ่าย / สถานะ) | Values | Meaning |
| --- | --- | --- | --- |
| **`pay_type`** | การจ่าย | `monthly` (รายเดือน) · `daily` (รายวัน) | how paid; `day_rate` is used **only** when `daily`. |
| **`employment_type`** | สถานะ | `permanent` (ประจำ) · `temporary` (ชั่วคราว) | tenure; Nova "external" = `temporary`. |

They are genuinely independent — any of the four combinations is valid and
expressible (a permanent daily ช่าง, a temporary daily ช่าง, a permanent monthly
ช่าง; a temporary monthly is unusual but not forbidden).

**Old → new mapping** (applied to the model, not to data — greenfield):

| Old | New |
| --- | --- |
| `worker_type='own'` | `pay_type='monthly'`, `employment_type='permanent'` |
| `worker_type='dc'` + `dc_arrangement='regular'` (internal DC) | `pay_type='daily'`, `employment_type='permanent'` |
| `worker_type='dc'` + `dc_arrangement='temporary'` (external DC) | `pay_type='daily'`, `employment_type='temporary'` |

### 3 — Payroll (ค่าแรง) covers daily ช่าง only

In-app payroll pays **daily** ช่าง (`pay_type='daily'`): `day_rate` × logged days.
Monthly ช่าง (`pay_type='monthly'`) are **paid off-app** (company payroll) and do
not appear in the in-app wage run. The payroll surface is renamed off "DC" —
**ค่าแรง** — and the payment domain renames from `dc_*` to `wage_*` (§7).

### 4 — Portal role split: technician vs contractor

The operator has decided to split the portal role **now** (it was a carried-open
question under ADR 0062, which had a ช่าง's portal login reuse the `contractor`
role):

- A **ช่าง's** portal login → `users.role = 'technician'`. `USER_ROLE_LABEL`:
  `technician` → **"ช่าง"**.
- `users.role = 'contractor'` → **subcontractor portal ONLY**.
  `USER_ROLE_LABEL`: `contractor` → **"ผู้รับเหมา"** (drop the "(DC)" suffix).

No `user_role` enum change — both values already exist (ADR 0008 / 0071). The
worker invite/claim RPCs (which currently set `role='contractor'` on claim) are
renamed off "DC" and set `role='technician'`; the subcontractor portal keeps
`contractor`. `roleHome`, RLS portal policies, and labels follow (U7).

### 5 — Subcontractors de-conflated and moved to their own menu

Subcontractors (ผู้รับเหมาช่วง — `contractors` table, `contractor_category='contractor'`)
are **functionally untouched**: same table, RPCs, RLS, crew register (spec 258),
payments. This ADR only (a) **moves** their settings entry into a **separate
menu** from ทีมช่าง (the roster + payroll move into a new ทีมช่าง section; the
subcontractor surfaces stay in master-data — U6), and (b) removes the "DC"
vocabulary that had leaked onto them. `contractor_category='dc'` becomes fully
retired (§7).

### 6 — `workers.contractor_id` is kept, nullable, NULL for a ช่าง (no spec-258 collision)

The prompt required verifying this before dropping/keeping the column. **Verified:**
subcontractor crew (spec 258) is a **separate table** — `subcontract_crew_members`
— explicitly *"a THIRD person category, not `workers`"* (migration
`20260813070100`). So `workers.contractor_id` is **not** used by subcontractor
crew; its only remaining consumer is the legacy `create_worker(p_contractor)` /
`contact-crew-section` path that predates spec 258.

**Decision:** **keep `workers.contractor_id` as a plain nullable FK**, always
**NULL** for a ช่าง (the merged company identity is firm-parentless). Rationale:
(a) no collision to resolve — crew has its own table; (b) dropping it would force
touching the out-of-scope legacy `contact-crew-section` flow and widen U1's blast
radius; (c) a nullable-unused FK is harmless and reversible-forward. The **CHECK
constraints that reference `worker_type`** (`workers_dc_has_contractor` if still
present, and the `own`-must-not-have-contractor check) are **dropped** as part of
removing the `worker_type` enum, so `contractor_id` survives with no `worker_type`
coupling. Retiring `contact-crew-section` + dropping `workers.contractor_id` is a
recorded **future cleanup** (Open questions), not in this program's scope.

### 7 — Schema rebuild (greenfield; clean, not a compatibility shim)

Because prod is greenfield, the change is a **clean rebuild**, not a
backward-compatible migration:

- **New enums:** `public.pay_type` (`monthly`, `daily`), `public.employment_type`
  (`permanent`, `temporary`).
- **`workers`:** add `pay_type` + `employment_type` (both `not null`, sensible
  defaults for the rebuild); **drop `worker_type` and `dc_arrangement`** and
  **drop the enums** `public.worker_type` and `public.dc_arrangement` — but only
  **after** every reference (RPC bodies, CHECKs, grants, `labor_logs` snapshot,
  app code, generated types) is removed first (dropping a type in use fails).
  `day_rate` and the payee/PII columns (phone, tax_id, bank_*, date_of_birth,
  emergency_contact_*) are **unchanged** — they already exist (ADR 0062 U1/U4b,
  re-verified live; a recurring false "workers has no such columns" claim is
  wrong). `day_rate` stays money-isolated (zero authenticated grant).
- **Renames (off "DC"):**
  - table `dc_payments` → **`wage_payments`**
  - `record_dc_payment` → **`record_wage_payment`**
  - `get_my_dc_payments` → **`get_my_wage_payments`**
  - `post_dc_payment_to_gl` → **`post_wage_payment_to_gl`**
  - enum `dc_payment_method` → **`wage_payment_method`**
  - `labor_logs.worker_type_snapshot` → **`pay_type_snapshot`** (its type becomes
    `pay_type`), and **drop `labor_logs.contractor_id_snapshot`** (vestigial).
  - RPC bodies re-sourced **verbatim from LIVE** before rename/rebuild
    (db-migration-lessons: never hand-copy an old migration; a rename's blast
    radius = every SECURITY DEFINER that reads the object — here the GL enqueue
    trigger + `drain_gl_posting`'s CASE arm + `post_wage_payment_to_gl`).
    `drain_gl_posting` / `source_event` naming updated in lockstep.
- **`approve_staff_registration` (ADR 0072 §4):** its field-role side-effect
  currently inserts `workers(worker_type='own', …)`. Repoint it to set
  **`pay_type='monthly'`, `employment_type='permanent'`** by default, and accept
  optional `p_pay_type` / `p_employment_type` overrides (an approver onboarding a
  daily/temporary ช่าง may set them). Its pgTAP (now file **264b**, not the
  spec-263 `263b` the prompt named — spec 264 renamed it) is updated for the two
  new fields.
- **Retire `contractor_category='dc'`** usage (the enum *value* may remain unused,
  per the ADR 0008 / 0062 no-drop-enum-value precedent; nothing writes it).
- **Wipe the test rows:** delete the 1 test `workers` row and the 1 test
  `staff_registration` row as part of the rebuild (greenfield reset).

All of this is **DESTRUCTIVE** (DROP COLUMN, DROP TYPE, rename, DELETE) →
`break-glass.md` Procedure B posture → the U1 migration is **operator-held**, not
self-merged (§Units).

### 8 — No compatibility with the old vocabulary

There is no dual-write or alias period. After U1, `worker_type` / `dc_arrangement`
/ `dc_payments` / "DC" **do not exist**. The unit sequence removes code references
**before** the destructive drop so nothing dangles.

## Consequences

**Positive**

- Two orthogonal, independently-settable fields model reality; "an internal DC" is
  just a `daily` + `permanent` ช่าง, expressible without special cases.
- The term "DC" is gone end-to-end (schema, UI, labels, payroll, portal role).
- Company ช่าง and subcontractors are cleanly separated (own menus, no shared
  "DC" vocabulary).
- Portal identity is honest: a ช่าง logs in as `technician` ("ช่าง"), a
  subcontractor as `contractor` ("ผู้รับเหมา").

**Negative / cost**

- Wide, destructive rebuild touching money (`wage_payments`), the GL poster + drain
  arm (ADR 0057), the live portal RLS (ADR 0051), Nova (`distribute_project_coins`),
  the staff-onboarding approve RPC (ADR 0072), and ~25 app files. Each unit is
  TDD'd + pgTAP-covered; U1 (destructive) and U7 (auth/RLS) are operator-held.
- A column/enum rename's blast radius = every SECURITY DEFINER that reads it; bodies
  must be re-sourced from LIVE, or a PM-gate / project_director arm silently drops
  (a repeatedly-hit lesson).

**Neutral**

- No `user_role` enum change (`technician`/`contractor` already exist). No
  `registration_status` / `employee_id` change. `contractor_category` keeps its
  `dc` value unused (no enum-value drop).
- `workers.contractor_id` survives nullable/unused (§6).

## Units (built one per session/branch, TDD test-first, shipped via `scripts/ship-pr.sh`)

Sequence: **U0 → U1 → (U2, U3, U4, U6) → U5 → U7 → U8.**

- **U0 — this ADR + spec 266 + progress-tracker entry + index rows.** Docs only.
  ADR under `docs/decisions/` → governance path → guard **HOLDS** for operator
  admin-merge (expected).
- **U1 — schema rebuild migration + `db:types` + pgTAP.** New enums; add
  `pay_type`/`employment_type`; drop `worker_type`/`dc_arrangement` (+ their enums
  + CHECKs); rename `dc_payments`→`wage_payments` and the four RPCs + method enum +
  `labor_logs` snapshot col; repoint `approve_staff_registration`; wipe test rows.
  **DESTRUCTIVE → OPERATOR-HELD 🔔.** Gates U2+. (Re-verify live counts + column
  existence immediately before pushing.)
- **U2 — repoint code branches** off `worker_type==='dc'` → `pay_type==='daily'`
  (labor `payroll.ts`, `cost.ts`, `group-workers.ts`, `fetch-payroll.ts`, and the
  adjacent payment/zone readers) + vitest. Code-only.
- **U3 — roster** (`/workers` + `worker-roster-manager`): ช่าง with การจ่าย /
  สถานะ selectors; payee (bank/tax) fields gate on `pay_type='daily'`. Code-only.
- **U4 — payroll** (`/payroll`) relabel to ค่าแรง + `wage_payments` naming; per-ช่าง
  wage cards. Code-only.
- **U5 — Nova:** `distribute_project_coins` "external" reads
  `employment_type='temporary'` (+ rename the `p_include_dc` param); pgTAP 106/….
  Money/GL → guard decides (likely held).
- **U6 — settings IA:** new **"ทีมช่าง"** section (move roster + payroll out of
  ข้อมูลหลัก); subcontractors stay in master-data; `settings-sections` test.
  Code-only.
- **U7 — role / portal split:** worker portal → role `technician`; rename the
  worker invite/claim RPCs off "DC"; `/portal` branch technician vs contractor;
  RLS + `role-home` + `USER_ROLE_LABEL`. **AUTH/RLS → OPERATOR-HELD 🔔.**
- **U8 — labels + cleanup:** `daily-report/flex.ts` + a `WORKER` label SSOT in
  `labels.ts`; retire every remaining "DC" string; pgTAP/vitest cleanup;
  `i18n-labels` pin. Code-only.

## Open questions (flagged, not built)

- **Retire `contact-crew-section` + drop `workers.contractor_id`?** The column is
  kept nullable/unused now (§6); a future cleanup can drop it once the legacy
  worker-under-contractor UI is removed. 🔔
- **A temporary *monthly* ช่าง** — the fourth combination — is expressible but has
  no known use; left valid (no CHECK forbidding it). 🔔
- **Approval-time pay/tenure selectors:** U1 gives `approve_staff_registration`
  optional `p_pay_type`/`p_employment_type`; whether the spec-264 approval UI
  surfaces them (vs always defaulting monthly/permanent + editing on the roster)
  is a small UI seam, defaulted to roster-edit. 🔔

## References

- ADR 0062 — A DC is a worker, not a contractor party (**superseded by this ADR**;
  spine kept, `worker_type`/`dc_arrangement`/"DC" reversed)
- ADR 0072 — Staff self-onboarding (the `approve_staff_registration` field-role
  worker-INSERT this repoints; the "DC→technician merge" out-of-scope note this
  fulfills)
- ADR 0071 — Technician self-registration (role); ADR 0070 — role = enum value
- ADR 0060 / 0061 — Nova economics / worker ecosystem ("external" tier)
- ADR 0051 — external-partner portal (`contractor` role now = subcontractor only)
- ADR 0057 — in-app GL feeding PEAK (the wage poster + drain arm rename)
- ADR 0050 — super_admin role management; ADR 0008 — role-enum expansion
- Spec 266 — `docs/feature-specs/266-worker-identity-merge.md`
- Memory: `dc-is-a-worker-adr0062`, `prc-ops-pay-model`, `ui-term-consistency-ssot`
