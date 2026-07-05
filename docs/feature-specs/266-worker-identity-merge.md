# Spec 266 — Worker identity merge: DC → ช่าง (one worker, `pay_type` × `employment_type`)

**ADR:** 0073 (supersedes 0062). **Status:** DRAFT / in progress (U0 shipped).
**Goal:** remove the term **"DC"** from the app entirely; merge `own` + `dc` into
ONE worker identity = **ช่าง** (group **ทีมช่าง**), described by two orthogonal
fields; keep company technicians and subcontractors in **separate** settings menus.

Read ADR 0073 in full first — it holds the locked design and rationale. This spec
is the buildable unit breakdown. Every design decision below is **locked**;
micro-decisions (SQL identifier spelling, unit file boundaries) are the builder's.

## The locked model

- **ช่าง** = the individual worker (`workers` row). **ทีมช่าง** = the group/menu.
  No more `own`/`dc`; the word "DC" appears nowhere.
- Two **independent** fields on `workers`:
  - **`pay_type`** (การจ่าย): `monthly` (รายเดือน) | `daily` (รายวัน) — `day_rate`
    used only when `daily`.
  - **`employment_type`** (สถานะ): `permanent` (ประจำ) | `temporary` (ชั่วคราว) —
    Nova "external" = `temporary`.
- **Old → new:** `own` → (`monthly`,`permanent`) · `dc`+`regular` →
  (`daily`,`permanent`) · `dc`+`temporary` → (`daily`,`temporary`).
- **ค่าแรง** (in-app payroll) pays **daily** ช่าง only; monthly is off-app.
- **Portal role split:** ช่าง portal login → role `technician` ("ช่าง");
  `contractor` = subcontractor portal only ("ผู้รับเหมา", drop "(DC)").
- **Subcontractors** (ผู้รับเหมาช่วง, `contractors`) functionally untouched — moved
  to their own menu, de-conflated from "DC".

## Greenfield precondition (re-verify before U1)

Prod is greenfield — re-confirm immediately before the destructive migration
(single-line SQL via `pnpm exec supabase db query --linked --file X.sql`; cast enum
cols `::text` in any `coalesce`): `workers` = 1 test row, `dc_payments` = 0,
`labor_logs` = 0, `contractors` = 2 (subcontractors, untouched),
`staff_registrations` = 1 test row, no `technician`/`contractor` users. The 1 test
worker + 1 test registration are **wiped** in U1. If any count is non-zero beyond
these, **stop and flag** — the no-backfill assumption is broken.

## Units

Sequence: **U0 → U1 → (U2, U3, U4, U6) → U5 → U7 → U8.** Each: own worktree branch,
TDD test-first, ship via `scripts/ship-pr.sh`.

### U0 — ADR + spec + tracker (docs) — SHIPPED
ADR 0073, this spec, progress-tracker entry, ADR + feature-spec index rows.
Governance path → guard holds for operator admin-merge.

### U1 — schema rebuild (DESTRUCTIVE → OPERATOR-HELD 🔔). Gates U2+.
**Migration** (timestamp `20260813071700+`; re-verify next free number):
- `create type public.pay_type as enum ('monthly','daily');`
- `create type public.employment_type as enum ('permanent','temporary');`
- `workers`: add `pay_type public.pay_type not null default 'monthly'`,
  `employment_type public.employment_type not null default 'permanent'`; **drop**
  `dc_arrangement`, then `worker_type` (after their readers are gone); drop the
  CHECKs referencing `worker_type`; **drop type** `public.dc_arrangement` and
  `public.worker_type`. Keep `workers.contractor_id` nullable (ADR 0073 §6). Fix
  the `grant select (…)` column list (drop `worker_type`, add the two new cols if
  they belong in the granted set — `pay_type`/`employment_type` are not money, so
  they may be granted like `name`; `day_rate` stays isolated).
- **Rename off "DC":** `alter table public.dc_payments rename to wage_payments;`
  (+ index/constraint names); enum `dc_payment_method` → `wage_payment_method`;
  `labor_logs.worker_type_snapshot` → `pay_type_snapshot` (type → `pay_type`);
  **drop** `labor_logs.contractor_id_snapshot`.
- **RPCs re-sourced verbatim from LIVE**, then renamed/rebuilt (DROP+CREATE where
  return/signature changes; re-apply EXECUTE lockdown for new sigs):
  `record_dc_payment`→`record_wage_payment`, `get_my_dc_payments`→
  `get_my_wage_payments`, `post_dc_payment_to_gl`→`post_wage_payment_to_gl`.
  Update `drain_gl_posting`'s CASE arm + `source_event` string + the AFTER-INSERT
  enqueue trigger on the renamed table (blast-radius: grep every SECURITY DEFINER
  reading the old names).
- **`approve_staff_registration`** (ADR 0072 §4): field-role branch sets
  `pay_type='monthly'`, `employment_type='permanent'` (was `worker_type='own'`);
  add optional `p_pay_type`/`p_employment_type` (defaults as above). Re-source the
  body from LIVE; preserve the STAFF_ASSIGNABLE_ROLES guard + PII copy.
- **Wipe** the 1 test worker + 1 test `staff_registration` (greenfield reset).
- **Retire** `contractor_category='dc'` writes (value kept unused).

**Tests:** pgTAP — new/updated file for `workers` (pay_type/employment_type
present, worker_type/dc_arrangement gone, CHECKs gone), `wage_payments` table +
renamed RPCs (execute-lockdown sig pins updated — files 36/rpc-execute-lockdown),
GL fixtures repointed (wage line still party-less), Nova fixture uses
`employment_type='temporary'` (file 106 — coordinate with U5), and
`approve_staff_registration` two-field assertion (file **264b**). `db:types` regen
(src + worker). Then `pnpm lint && pnpm typecheck && pnpm test` — expect app code
to still reference old names → those move in U2+, so U1 keeps types compiling by
regenerating + doing the **minimal** src edits needed to typecheck (the deep
repoint is U2). **Verify:** `db:push`, `db:test` green (no new failures beyond
known pre-existing flakes), `db push --dry-run` = up to date.

### U2 — repoint code off `worker_type` → `pay_type` (code-only)
`src/lib/labor/`: `payroll.ts`, `cost.ts`, `group-workers.ts`, `fetch-payroll.ts`
(+ `fetch-zone-data.ts`, `payments.ts`, `fetch-payments.ts`, `actions.ts`,
`wp-budget-summary.ts` as fallout). Every `worker_type === 'dc'` → `pay_type ===
'daily'`; every `worker_type === 'own'` → `pay_type === 'monthly'`; drop
`dc_arrangement` reads (use `employment_type`). Vitest for each pure helper.
**Verify:** lint/typecheck/test green; no `worker_type`/`dc_arrangement` left in
`src/` (grep).

### U3 — roster `/workers` + `worker-roster-manager` (code-only)
Add/edit a ช่าง with **การจ่าย** (pay_type) + **สถานะ** (employment_type)
selectors. Payee fields (bank/tax) gate on `pay_type='daily'` (a monthly ช่าง is
paid off-app → no in-app bank needed). `create_worker`/`update_worker` already
carry the params after U1; wire the two selectors. Drop any "DC"/"own" labels.
Vitest for the roster view-model + gate logic. **Verify:** lint/typecheck/test.

### U4 — payroll `/payroll` relabel (code-only)
Rename the surface to **ค่าแรง**; per-ช่าง wage cards; `wage_payments` naming
through `record-payment-sheet` + `fetch-payments`/`payments.ts`. Only daily ช่าง
listed. Vitest. **Verify:** lint/typecheck/test.

### U5 — Nova external tier (money/GL → guard decides, likely held 🔔)
`distribute_project_coins`: "external" reads `employment_type='temporary'` (was
`dc_arrangement='temporary'`); rename param `p_include_dc` → an
employment-neutral name. `coin_unvested_balance` if it also reads the old col.
pgTAP 106/108 fixtures set `employment_type='temporary'`. CREATE OR REPLACE where
sigs are unchanged (preserve grants). **Verify:** db:test.

### U6 — settings IA (code-only)
New **"ทีมช่าง"** settings section grouping the roster + payroll (moved out of
ข้อมูลหลัก). Subcontractor surfaces stay in master-data. Update
`settings-sections` SSOT + its test. **Verify:** lint/typecheck/test.

### U7 — role / portal split (AUTH/RLS → OPERATOR-HELD 🔔)
Worker invite/claim RPCs renamed off "DC"; `claim_worker_invite` sets
`role='technician'` (was `contractor`). `/portal` branches technician (ช่าง view)
vs contractor (subcontractor view). RLS portal policies + `role-home` (technician
home already exists per ADR 0072 §8) + `USER_ROLE_LABEL` (`technician`→"ช่าง",
`contractor`→"ผู้รับเหมา"). pgTAP for the renamed RPCs + role on claim + RLS.
**Verify:** db:test + lint/typecheck/test.

### U8 — labels + final cleanup (code-only)
`daily-report/flex.ts` + a **`WORKER` label SSOT** in `labels.ts`; retire every
remaining "DC" string app-wide (grep); pgTAP/vitest cleanup; `i18n-labels` pin so
the ช่าง terms can't drift. **Verify:** lint/typecheck/test; grep confirms zero
"DC"/`worker_type`/`dc_` in `src/`.

## Out of scope

- Retiring `contact-crew-section` + dropping `workers.contractor_id` (kept
  nullable; future cleanup — ADR 0073 open Q).
- Subcontractor (ผู้รับเหมาช่วง) functional changes — only menu move + relabel.
- Approval-UI pay/tenure selectors (RPC accepts them; roster-edit is the default
  path — ADR 0073 open Q).
- A temporary-monthly ช่าง has no built use (valid, not forbidden).

## References
ADR 0073 (design), ADR 0062 (superseded), ADR 0072 (approve RPC), ADR 0057 (GL),
ADR 0051 (portal). Memory: `dc-is-a-worker-adr0062`, `prc-ops-pay-model`.
