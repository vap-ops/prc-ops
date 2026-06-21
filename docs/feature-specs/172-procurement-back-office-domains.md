# Spec 172 — Procurement owns contractors, equipment rentals, and DC onboarding

**Operator request (2026-06-21):** "Procurement also takes care of: 1. Contractors 2. Equipment Rentals 3. Onboarding DCs." Decisions (clarifying questions):
procurement gets **full ownership** — it **sets the DC pay rate** (not just
onboards) and **manages contractor bank** (not just non-bank fields); build **all
three this session**.

This extends procurement from the purchasing worklist (spec 70) + WP read-only PR
raising (spec 171) into a full back-office role across three domains. Each phase is
additive RLS/RPC + page-gate work, test-first, mirroring the existing back-office
posture (`BACK_OFFICE_ROLES` = pm/super/procurement/director).

**Concurrent-session note:** another session is committing spec-170 worker/portal
work **directly to `main`** and pushing migrations rapidly (prod at
`20260788000000` at plan time). DC onboarding (Phase C) is in that exact domain.
Mitigations: number migrations from `20260790000000+` after re-checking
`supabase migration list`; **source every RPC body I modify from the LIVE prod DB**
(`pg_get_functiondef`) — the other session may have changed it — not from an old
migration file; fetch+rebase on non-ff push.

## Phase A — Equipment rentals: ALREADY ENABLED (no permission work)

Audit result: procurement is **already fully wired** for equipment (spec 141/146):

- `equipment_items` / `equipment_movements` / `equipment_usage_logs` — SELECT +
  INSERT admit procurement; `/equipment` gates `EQUIPMENT_MOVE_ROLES` (incl.
  procurement) with `canManageRegistry` via `BACK_OFFICE_ROLES` (incl. procurement).
- RPCs `set_equipment_daily_rate`, `create_equipment_rental_batch`,
  `create_equipment_project_allocation`, `check_out_equipment`,
  `check_in_equipment` all gate `procurement`.
- Money columns (`monthly_rate`, `daily_rate_snapshot`, `acquisition_cost`) stay
  admin-only — intentional, unchanged.

**Therefore Phase A ships nothing.** The one real gap is app-wide, not a
procurement-permission issue: there is **no UI surface to view/manage rental
batches + allocations** (the RPCs create them; `/equipment` only lists registry +
movements). That is a **separate feature spec** (equipment-rental management UI),
not part of "enable procurement," and is recorded as a follow-up.

## Phase B — Procurement manages contractors (subcontractors), incl. bank

Today: procurement READS contractors (spec 171 U3) but cannot create/edit them or
reach the pages; contractors are PM-exclusive (unlike suppliers, which are already
back-office). DC contacts are out of scope here — `/contacts/dc` is being removed
by ADR 0062 (DC is a worker → Phase C).

- **New role const** `CONTACT_MGMT_ROLES` in `role-home.ts` = `BACK_OFFICE_ROLES`
  (pm/super/procurement/director) — "who curates contractor + bank master data",
  mirroring the suppliers posture. (Suppliers already use `BACK_OFFICE_ROLES`;
  contractors join them.)
- **RLS migration:**
  - `contractors` INSERT (`"contractors insert by staff"`) + UPDATE
    (`"contractors update by staff"`) — add `procurement` (sourced live;
    keep `created_by = auth.uid()` + `project_director`).
  - `contact_bank` — add `procurement` to the SELECT policy (read contractor bank)
    and to `set_contact_bank` RPC (the staff bank write path). The DC-portal
    `decide_contractor_bank_change` (pm/super) is the external-submit approval flow;
    leave it unless the operator wants procurement approving portal submissions.
  - `set_work_package_contractor` RPC — add `procurement` (assign a contractor to a
    WP).
- **Pages / actions:** gate `/contacts/subcontractors` + `/contacts/[type]/[id]`
  (contractor branch) on `CONTACT_MGMT_ROLES`; switch `createContractorRecord` /
  `updateContractorRecord` (+ the bank set action) from `pmSession` to a
  back-office session. Service providers stay PM-only.
- **Tests:** pgTAP — procurement can INSERT/UPDATE a contractor, set its bank, and
  assign it to a WP; flip any "procurement denied" pins (contractors file 24, bank
  file). Unit-test `CONTACT_MGMT_ROLES`.

## Phase C — Procurement onboards DCs (workers), incl. pay rate — SHIPPED 2026-06-21 (mig 20260796000000)

Today: procurement reads the roster (minus sensitive cols) but cannot create/
update/assign workers or reach `/workers`. DC = a `workers` record (ADR 0062);
bank/tax/phone/`day_rate` are zero-grant columns written only through the definer
RPCs. **Highest-risk phase** (money + PII) and in the concurrent session's domain.

**Shipped:** the concurrent spec-170 worker burst had settled (origin/main clean
at the Phase B docs commit), so Phase C built without a race. Each of the five
worker RPCs was re-sourced from the LIVE prod definition (`pg_get_functiondef`) —
the concurrent session had been editing them — and CREATE OR REPLACE'd with
`procurement` appended to the role gate, signatures UNCHANGED (so the
authenticated-only EXECUTE lockdown, pgTAP 36, is preserved and db:types needs no
regen). `project_director` stays in every list (file 91). The new
`WORKER_ROSTER_ROLES` (= `PM_ROLES` + procurement) gates `/workers`; ทีมงาน →
`/workers` is wired into `PROCUREMENT_HUB_NAV` + the procurement /settings block.
New pgTAP file 172 proves procurement create/update/assign/invite/set-rate AND
that bank/tax/phone/day_rate stay 42501 to a raw authenticated SELECT (PII
isolation preserved — only the definer WRITE path opens). db:test 119/2286/0.

- **New role const** `WORKER_ROSTER_ROLES` = `BACK_OFFICE_ROLES` (or `PM_ROLES` +
  procurement) — who reaches `/workers` + onboards.
- **RPCs (source each body from LIVE prod, then DROP+CREATE adding `procurement`):**
  `create_worker`, `update_worker`, `assign_worker_to_project`,
  `create_worker_invite`, and — per the operator's decision — `set_worker_day_rate`
  (procurement sets the DC pay rate too). Bank/tax/phone are written through these
  definer RPCs (the zero column-grant is bypassed by the definer); reading them
  back stays admin-client behind the page gate. project_director rides along
  (pgTAP file 91).
- **Page:** `/workers` gate `PM_ROLES` → `WORKER_ROSTER_ROLES`.
- **Tests:** pgTAP — procurement can create a DC worker (with arrangement + bank +
  rate), update, assign to a project, set day rate; sensitive columns remain
  unreadable by a raw authenticated SELECT (PII isolation preserved — only the RPC
  write path is opened). Flip "procurement denied" pins in the worker pgTAP files
  (29 / 36 / whichever pin the gates). Unit-test `WORKER_ROSTER_ROLES`.

## Sequencing

Build **A (none) → B (contractors, clean, off the concurrent session's domain) →
C (workers, in the concurrent session's domain — source RPCs live, number
migrations above the latest applied)**. Commit + push each phase promptly to keep
the uncommitted window small while `main` is shared.

## Out of scope

- Equipment-rental **management UI** (view/create batches, allocations, usage) —
  missing app-wide, separate spec.
- DC-portal bank-change **approval** by procurement (`decide_contractor_bank_change`
  stays pm/super) unless the operator asks.
- Editing an existing purchase request's content (spec 171 note).
